import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import * as schoolClassQueries from '../database/queries/school-classes.queries';
import * as studentsQueries from '../database/queries/students.queries';
import { DatabaseService } from '../database/database.service';
import { SchoolAccessService } from '../school-access/school-access.service';
import {
  createStudentSchema,
  updateStudentSchema,
} from '../validation/students.schema';
import { zodFirstMessage } from '../validation/zod-utils';

@Injectable()
export class StudentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly schoolAccess: SchoolAccessService,
  ) {}

  async list(
    user: JwtPayload,
    clientId: string,
    classId?: string,
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    if (classId) {
      const klass = await schoolClassQueries.getSchoolClassById(
        this.database.db,
        classId,
        clientId,
      );
      if (!klass) {
        throw new NotFoundException('Turma não encontrada.');
      }
      return studentsQueries.listStudentsByClass(
        this.database.db,
        clientId,
        classId,
      );
    }
    return studentsQueries.listStudentsByClient(this.database.db, clientId);
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
    return row;
  }

  async create(user: JwtPayload, clientId: string, body: unknown) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const parsed = createStudentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    if (d.classId) {
      const klass = await schoolClassQueries.getSchoolClassById(
        this.database.db,
        d.classId,
        clientId,
      );
      if (!klass) {
        throw new BadRequestException('Turma inválida para esta escola.');
      }
    }
    return studentsQueries.insertStudent(this.database.db, {
      clientId,
      name: d.name,
      enrollment: d.enrollment,
      document: d.document ?? null,
      birthDate: d.birthDate ?? null,
      classId: d.classId ?? null,
      photoKey: d.photoKey ?? null,
      accessSchedule: d.accessSchedule ?? null,
      isActive: d.isActive,
    });
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
    if (d.classId !== undefined && d.classId !== null) {
      const klass = await schoolClassQueries.getSchoolClassById(
        this.database.db,
        d.classId,
        clientId,
      );
      if (!klass) {
        throw new BadRequestException('Turma inválida para esta escola.');
      }
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
        ...(d.classId !== undefined ? { classId: d.classId } : {}),
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
    return updated;
  }
}
