import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import * as schoolClassQueries from '../database/queries/school-classes.queries';
import * as studentClassesQueries from '../database/queries/student-classes.queries';
import * as studentsQueries from '../database/queries/students.queries';
import { DatabaseService } from '../database/database.service';
import { SchoolAccessService } from '../school-access/school-access.service';
import { R2StorageService } from '../storage/r2-storage.service';
import {
  createStudentSchema,
  updateStudentSchema,
} from '../validation/students.schema';
import { zodFirstMessage } from '../validation/zod-utils';

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

  async list(
    user: JwtPayload,
    clientId: string,
    classId?: string,
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    let rows: Awaited<
      ReturnType<(typeof studentsQueries)['listStudentsByClient']>
    >;

    if (classId) {
      const klass = await schoolClassQueries.getSchoolClassById(
        this.database.db,
        classId,
        clientId,
      );
      if (!klass) {
        throw new NotFoundException('Turma não encontrada.');
      }
      rows = await studentsQueries.listStudentsByClass(
        this.database.db,
        clientId,
        classId,
      );
    } else {
      rows = await studentsQueries.listStudentsByClient(
        this.database.db,
        clientId,
      );
    }

    const withClasses = await this.attachClassesToStudents(rows);

    return Promise.all(
      withClasses.map(async (row) => ({
        ...row,
        photoUrl: await this.optionalPhotoUrl(row.photoKey),
      })),
    );
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
}
