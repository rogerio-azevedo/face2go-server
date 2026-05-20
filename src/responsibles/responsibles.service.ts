import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import { DatabaseService } from '../database/database.service';
import { users } from '../database/schema';
import { SchoolAccessService } from '../school-access/school-access.service';
import {
  createResponsibleSchema,
  linkResponsibleStudentSchema,
  updateResponsibleSchema,
  updateResponsibleStudentLinkSchema,
} from '../validation/responsibles.schema';
import { zodFirstMessage } from '../validation/zod-utils';

@Injectable()
export class ResponsiblesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly schoolAccess: SchoolAccessService,
  ) {}

  async list(user: JwtPayload, clientId: string) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    return responsiblesQueries.listResponsiblesByClient(
      this.database.db,
      clientId,
    );
  }

  async getById(user: JwtPayload, clientId: string, responsibleId: string) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const row = await responsiblesQueries.getResponsibleById(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Responsável não encontrado.');
    }
    return row;
  }

  async create(user: JwtPayload, clientId: string, body: unknown) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const parsed = createResponsibleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;

    const existing = await this.database.db.query.users.findFirst({
      where: eq(users.email, d.email),
    });
    if (existing) {
      throw new ConflictException('E-mail já cadastrado.');
    }

    const userId = crypto.randomUUID();
    const hashed = await bcrypt.hash(d.password, 10);

    try {
      await this.database.db.insert(users).values({
        id: userId,
        email: d.email,
        password: hashed,
        name: d.name,
        role: 'member',
        isActive: true,
      });

      return responsiblesQueries.insertResponsible(this.database.db, {
        clientId,
        userId,
        name: d.name,
        phone: d.phone ?? null,
        document: d.document ?? null,
        isActive: d.isActive,
      });
    } catch {
      await this.database.db.delete(users).where(eq(users.id, userId));
      throw new BadRequestException(
        'Não foi possível cadastrar o responsável.',
      );
    }
  }

  async update(
    user: JwtPayload,
    clientId: string,
    responsibleId: string,
    body: unknown,
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const parsed = updateResponsibleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    if (
      d.name === undefined &&
      d.phone === undefined &&
      d.document === undefined &&
      d.password === undefined &&
      d.isActive === undefined
    ) {
      throw new BadRequestException('Nada para atualizar.');
    }

    const existing = await responsiblesQueries.getResponsibleById(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!existing) {
      throw new NotFoundException('Responsável não encontrado.');
    }

    if (d.password !== undefined) {
      if (!existing.userId) {
        throw new BadRequestException(
          'Responsável sem conta de login; não é possível alterar senha.',
        );
      }
      const hashed = await bcrypt.hash(d.password, 10);
      await this.database.db
        .update(users)
        .set({ password: hashed })
        .where(eq(users.id, existing.userId));
    }

    const updated = await responsiblesQueries.updateResponsible(
      this.database.db,
      responsibleId,
      clientId,
      {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.phone !== undefined ? { phone: d.phone } : {}),
        ...(d.document !== undefined ? { document: d.document } : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      },
    );

    if (!updated) {
      throw new NotFoundException('Responsável não encontrado.');
    }

    if (d.name !== undefined && existing.userId) {
      await this.database.db
        .update(users)
        .set({ name: d.name })
        .where(eq(users.id, existing.userId));
    }

    return updated;
  }

  async listLinkedStudents(
    user: JwtPayload,
    clientId: string,
    responsibleId: string,
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const responsible = await responsiblesQueries.getResponsibleById(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!responsible) {
      throw new NotFoundException('Responsável não encontrado.');
    }
    return responsiblesQueries.listResponsibleStudentLinksWithStudents(
      this.database.db,
      responsibleId,
      clientId,
    );
  }

  async linkStudent(
    user: JwtPayload,
    clientId: string,
    responsibleId: string,
    body: unknown,
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const parsed = linkResponsibleStudentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;

    const responsible = await responsiblesQueries.getResponsibleById(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!responsible) {
      throw new NotFoundException('Responsável não encontrado.');
    }

    const student = await studentsQueries.getStudentById(
      this.database.db,
      d.studentId,
      clientId,
    );
    if (!student) {
      throw new BadRequestException('Aluno não encontrado nesta escola.');
    }

    try {
      return responsiblesQueries.insertResponsibleStudentLink(
        this.database.db,
        {
          responsibleId,
          studentId: d.studentId,
          relationshipType: d.relationshipType,
          isAuthorizedPickup: d.isAuthorizedPickup,
        },
      );
    } catch {
      throw new ConflictException(
        'Este vínculo já existe ou não pôde ser criado.',
      );
    }
  }

  async updateLink(
    user: JwtPayload,
    clientId: string,
    responsibleId: string,
    studentId: string,
    body: unknown,
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const parsed = updateResponsibleStudentLinkSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    if (
      d.relationshipType === undefined &&
      d.isAuthorizedPickup === undefined
    ) {
      throw new BadRequestException('Nada para atualizar.');
    }

    const responsible = await responsiblesQueries.getResponsibleById(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!responsible) {
      throw new NotFoundException('Responsável não encontrado.');
    }

    const patch = {
      ...(d.relationshipType !== undefined
        ? { relationshipType: d.relationshipType }
        : {}),
      ...(d.isAuthorizedPickup !== undefined
        ? { isAuthorizedPickup: d.isAuthorizedPickup }
        : {}),
    };

    const updated =
      await responsiblesQueries.updateResponsibleStudentLink(
        this.database.db,
        responsibleId,
        studentId,
        patch,
      );
    if (!updated) {
      throw new NotFoundException('Vínculo não encontrado.');
    }
    return updated;
  }

  async unlinkStudent(
    user: JwtPayload,
    clientId: string,
    responsibleId: string,
    studentId: string,
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const responsible = await responsiblesQueries.getResponsibleById(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!responsible) {
      throw new NotFoundException('Responsável não encontrado.');
    }
    const removed = await responsiblesQueries.deleteResponsibleStudentLink(
      this.database.db,
      responsibleId,
      studentId,
    );
    if (!removed) {
      throw new NotFoundException('Vínculo não encontrado.');
    }
    return { removed: true };
  }
}
