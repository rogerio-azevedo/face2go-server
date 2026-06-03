import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as schoolClassQueries from '../database/queries/school-classes.queries';
import * as studentClassesQueries from '../database/queries/student-classes.queries';
import * as studentsQueries from '../database/queries/students.queries';
import { DatabaseService } from '../database/database.service';
import { AccessTimeZoneService } from '../face-sync/access-time-zone.service';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { SchoolAccessService } from '../school-access/school-access.service';
import { R2StorageService } from '../storage/r2-storage.service';
import {
  buildPaginatedResult,
  parseListPaginationParams,
  type ListPaginationParams,
  type PaginatedResult,
} from '../common/pagination';
import {
  createStudentSchema,
  linkStudentClassSchema,
  updateStudentSchema,
} from '../validation/students.schema';
import { zodFirstMessage } from '../validation/zod-utils';

type StudentListQueryInput = ListPaginationParams & {
  classId?: string;
};

function mapStudentClassLinkToApi(
  link: studentClassesQueries.StudentClassLinkRow,
) {
  return {
    id: link.id,
    classId: link.classId,
    className: link.className,
    shiftId: link.shiftId,
    linkedShiftName: link.linkedShiftName,
    shift: link.shift,
    year: link.year,
    situacaoMatricula: link.situacaoMatricula,
    isActive: link.isActive,
  };
}

@Injectable()
export class StudentsService {
  private readonly log = new Logger(StudentsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly schoolAccess: SchoolAccessService,
    private readonly r2Storage: R2StorageService,
    private readonly faceSync: FaceSyncService,
    private readonly accessTimeZone: AccessTimeZoneService,
  ) {}

  private async attachClassesToStudents<
    T extends { id: string },
  >(rows: T[]): Promise<(T & { classes: ReturnType<typeof mapStudentClassLinkToApi>[] })[]> {
    if (rows.length === 0) return [];
    const links = await studentClassesQueries.listClassesByStudentIds(
      this.database.db,
      rows.map((r) => r.id),
    );
    const byStudent = new Map<string, ReturnType<typeof mapStudentClassLinkToApi>[]>();
    for (const link of links) {
      const list = byStudent.get(link.studentId) ?? [];
      list.push(mapStudentClassLinkToApi(link));
      byStudent.set(link.studentId, list);
    }
    return rows.map((row) => ({
      ...row,
      classes: byStudent.get(row.id) ?? [],
    }));
  }

  private async mapStudentWithPhoto<
    T extends { photoKey: string | null },
  >(row: T) {
    return {
      ...row,
      photoUrl: await this.optionalPhotoUrl(row.photoKey),
    };
  }

  async list(
    user: JwtPayload,
    clientId: string,
    query: StudentListQueryInput = {},
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const { page, pageSize, search, offset } = parseListPaginationParams(
      query.page !== undefined ? String(query.page) : undefined,
      query.pageSize !== undefined ? String(query.pageSize) : undefined,
      query.search,
    );
    const listOpts = { search, offset, limit: pageSize };
    const classId = query.classId;

    let rows: Awaited<
      ReturnType<(typeof studentsQueries)['listStudentsByClient']>
    >;
    let total: number;

    if (classId) {
      const klass = await schoolClassQueries.getSchoolClassById(
        this.database.db,
        classId,
        clientId,
      );
      if (!klass) {
        throw new NotFoundException('Turma não encontrada.');
      }
      total = await studentsQueries.countStudentsByClass(
        this.database.db,
        clientId,
        classId,
        { search },
      );
      rows = await studentsQueries.listStudentsByClass(
        this.database.db,
        clientId,
        classId,
        listOpts,
      );
    } else {
      total = await studentsQueries.countStudentsByClient(
        this.database.db,
        clientId,
        { search },
      );
      rows = await studentsQueries.listStudentsByClient(
        this.database.db,
        clientId,
        listOpts,
      );
    }

    const withClasses = await this.attachClassesToStudents(rows);
    const data = await Promise.all(
      withClasses.map((row) => this.mapStudentWithPhoto(row)),
    );

    return buildPaginatedResult(data, total, page, pageSize);
  }

  private async optionalPhotoUrl(photoKey: string | null): Promise<string | null> {
    if (!photoKey) return null;
    try {
      return await this.r2Storage.createPresignedGetUrl(photoKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(
        `URL assinada (aluno/R2): falha para key="${photoKey}": ${msg}`,
      );
      return null;
    }
  }

  private async optionalResponsiblePhotoUrl(
    photoKey: string | null,
  ): Promise<string | null> {
    if (!photoKey) return null;
    try {
      return await this.r2Storage.createPresignedPortraitGetUrl(photoKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(
        `URL assinada (responsável/R2): falha para key="${photoKey}": ${msg}`,
      );
      return null;
    }
  }

  async listLinkedResponsibles(
    user: JwtPayload,
    clientId: string,
    studentId: string,
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const student = await studentsQueries.getStudentById(
      this.database.db,
      studentId,
      clientId,
    );
    if (!student) {
      throw new NotFoundException('Aluno não encontrado.');
    }
    const rows =
      await responsiblesQueries.listStudentResponsibleLinksWithResponsibles(
        this.database.db,
        studentId,
        clientId,
      );
    return Promise.all(
      rows.map(async (item) => ({
        link: item.link,
        responsible: {
          ...item.responsible,
          photoUrl: await this.optionalResponsiblePhotoUrl(
            item.responsible.photoKey,
          ),
        },
      })),
    );
  }

  async getById(user: JwtPayload, clientId: string, studentId: string) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const row = await studentsQueries.getStudentById(
      this.database.db,
      studentId,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Aluno não encontrado.');
    }
    const [withClasses] = await this.attachClassesToStudents([row]);
    return {
      ...withClasses,
      photoUrl: await this.optionalPhotoUrl(row.photoKey),
    };
  }

  async create(user: JwtPayload, clientId: string, body: unknown) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const parsed = createStudentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    const row = await studentsQueries.insertStudent(this.database.db, {
      clientId,
      name: d.name,
      enrollment: d.enrollment,
      document: d.document ?? null,
      birthDate: d.birthDate ?? null,
      photoKey: d.photoKey ?? null,
      accessSchedule: d.accessSchedule ?? null,
      isActive: d.isActive,
    });

    if (d.classIds?.length) {
      const uniqueClassIds = [...new Set(d.classIds)];
      for (const classId of uniqueClassIds) {
        const klass = await schoolClassQueries.getSchoolClassById(
          this.database.db,
          classId,
          clientId,
        );
        if (!klass) {
          throw new BadRequestException('Turma não encontrada nesta escola.');
        }
        if (!klass.isActive) {
          throw new BadRequestException('Turma inativa não pode ser vinculada.');
        }
        await studentClassesQueries.upsertStudentClassLink(this.database.db, {
          studentId: row!.id,
          classId,
          situacaoMatricula: 'enrolled',
          isActive: true,
        });
      }
    }

    const [withClasses] = await this.attachClassesToStudents([row!]);
    return withClasses;
  }

  async update(
    user: JwtPayload,
    clientId: string,
    studentId: string,
    body: unknown,
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const parsed = updateStudentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    if (Object.keys(d).length === 0) {
      throw new BadRequestException('Nada para atualizar.');
    }
    const updated = await studentsQueries.updateStudent(
      this.database.db,
      studentId,
      clientId,
      {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.enrollment !== undefined ? { enrollment: d.enrollment } : {}),
        ...(d.document !== undefined ? { document: d.document } : {}),
        ...(d.birthDate !== undefined ? { birthDate: d.birthDate } : {}),
        ...(d.photoKey !== undefined ? { photoKey: d.photoKey } : {}),
        ...(d.accessSchedule !== undefined
          ? { accessSchedule: d.accessSchedule }
          : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      },
    );
    if (!updated) {
      throw new NotFoundException('Aluno não encontrado.');
    }
    const [withClasses] = await this.attachClassesToStudents([updated]);
    return withClasses;
  }

  async linkClass(
    user: JwtPayload,
    clientId: string,
    studentId: string,
    body: unknown,
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const parsed = linkStudentClassSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const student = await studentsQueries.getStudentById(
      this.database.db,
      studentId,
      clientId,
    );
    if (!student) {
      throw new NotFoundException('Aluno não encontrado.');
    }

    const klass = await schoolClassQueries.getSchoolClassById(
      this.database.db,
      parsed.data.classId,
      clientId,
    );
    if (!klass) {
      throw new BadRequestException('Turma não encontrada nesta escola.');
    }
    if (!klass.isActive) {
      throw new BadRequestException('Turma inativa não pode ser vinculada.');
    }

    const result = await studentClassesQueries.upsertStudentClassLink(
      this.database.db,
      {
        studentId,
        classId: parsed.data.classId,
        situacaoMatricula: 'enrolled',
        isActive: true,
      },
    );

    const links = await studentClassesQueries.listClassesByStudent(
      this.database.db,
      studentId,
    );
    const link = links.find((item) => item.id === result.id);
    if (!link) {
      throw new NotFoundException('Vínculo não encontrado após criação.');
    }

    return mapStudentClassLinkToApi(link);
  }

  async unlinkClass(
    user: JwtPayload,
    clientId: string,
    studentId: string,
    classId: string,
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);

    const student = await studentsQueries.getStudentById(
      this.database.db,
      studentId,
      clientId,
    );
    if (!student) {
      throw new NotFoundException('Aluno não encontrado.');
    }

    const klass = await schoolClassQueries.getSchoolClassById(
      this.database.db,
      classId,
      clientId,
    );
    if (!klass) {
      throw new NotFoundException('Turma não encontrada.');
    }

    const removed = await studentClassesQueries.deactivateStudentClassLink(
      this.database.db,
      studentId,
      classId,
    );
    if (!removed) {
      throw new NotFoundException('Vínculo não encontrado.');
    }

    return { success: true };
  }

  async syncFaceByCompany(
    user: JwtPayload,
    clientId: string,
    studentId: string,
  ): Promise<{
    deviceSyncStatus: 'synced' | 'sync_failed' | 'pending_sync';
    deviceSyncError: string | null;
  }> {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const student = await studentsQueries.getStudentById(
      this.database.db,
      studentId,
      clientId,
    );
    if (!student) {
      throw new NotFoundException('Aluno não encontrado.');
    }
    if (!student.photoKey || student.faceId == null) {
      throw new BadRequestException('Sem foto cadastrada para sincronizar.');
    }

    let buffer: Buffer;
    try {
      const got = await this.r2Storage.getObjectBytes(student.photoKey);
      buffer = got.buffer;
    } catch {
      throw new BadRequestException(
        'Não foi possível obter a foto armazenada.',
      );
    }
    if (buffer.length < 256) {
      throw new BadRequestException(
        'Imagem armazenada inválida ou muito pequena.',
      );
    }

    await studentsQueries.updateStudentFace(
      this.database.db,
      studentId,
      clientId,
      {
        deviceSyncStatus: 'pending_sync',
        deviceSyncedAt: null,
        deviceSyncError: null,
      },
    );

    const sync = await this.faceSync.syncPersonOnReaders({
      clientId,
      faceId: student.faceId,
      name: student.name,
      imageBuffer: buffer,
      timeSectionIds: await this.accessTimeZone.resolveStudentTimeSections(
        clientId,
        studentId,
      ),
      logContext: `student-sync=${studentId}`,
    });

    await studentsQueries.updateStudentFace(
      this.database.db,
      studentId,
      clientId,
      {
        deviceSyncStatus: sync.deviceSyncStatus,
        deviceSyncedAt:
          sync.deviceSyncStatus === 'synced' ? new Date() : null,
        deviceSyncError: sync.deviceSyncError,
      },
    );

    return {
      deviceSyncStatus: sync.deviceSyncStatus,
      deviceSyncError: sync.deviceSyncError,
    };
  }
}
