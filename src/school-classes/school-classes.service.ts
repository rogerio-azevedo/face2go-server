import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import * as schoolClassQueries from '../database/queries/school-classes.queries';
import * as shiftsQueries from '../database/queries/shifts.queries';
import { DatabaseService } from '../database/database.service';
import { SchoolAccessService } from '../school-access/school-access.service';
import {
  createSchoolClassSchema,
  updateSchoolClassSchema,
} from '../validation/school-classes.schema';
import { zodFirstMessage } from '../validation/zod-utils';

@Injectable()
export class SchoolClassesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly schoolAccess: SchoolAccessService,
  ) {}

  async list(user: JwtPayload, clientId: string) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    return schoolClassQueries.listSchoolClassesByClient(
      this.database.db,
      clientId,
    );
  }

  async create(user: JwtPayload, clientId: string, body: unknown) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const parsed = createSchoolClassSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    const shift = await shiftsQueries.getShiftById(
      this.database.db,
      d.shiftId,
      clientId,
    );
    if (!shift) {
      throw new BadRequestException('Turno inválido para esta escola.');
    }
    return schoolClassQueries.insertSchoolClass(this.database.db, {
      clientId,
      name: d.name,
      shiftId: d.shiftId,
      shift: null,
      year: d.year,
      isActive: d.isActive,
    });
  }

  async update(
    user: JwtPayload,
    clientId: string,
    classId: string,
    body: unknown,
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const parsed = updateSchoolClassSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    if (
      d.name === undefined &&
      d.shiftId === undefined &&
      d.year === undefined &&
      d.isActive === undefined
    ) {
      throw new BadRequestException('Nada para atualizar.');
    }
    if (d.shiftId !== undefined && d.shiftId !== null) {
      const shift = await shiftsQueries.getShiftById(
        this.database.db,
        d.shiftId,
        clientId,
      );
      if (!shift) {
        throw new BadRequestException('Turno inválido para esta escola.');
      }
    }
    const updated = await schoolClassQueries.updateSchoolClass(
      this.database.db,
      classId,
      clientId,
      {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.shiftId !== undefined ? { shiftId: d.shiftId } : {}),
        ...(d.year !== undefined ? { year: d.year } : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      },
    );
    if (!updated) {
      throw new NotFoundException('Turma não encontrada.');
    }
    return updated;
  }
}
