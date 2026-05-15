import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import * as pickupQueries from '../database/queries/pickup-authorizations.queries';
import type { PickupAuthRow } from '../database/queries/pickup-authorizations.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import { DatabaseService } from '../database/database.service';
import { SchoolAccessService } from '../school-access/school-access.service';
import {
  computeEffectivePickupStatus,
  createPickupAuthorizationSchema,
} from '../validation/pickup-authorizations.schema';
import { zodFirstMessage } from '../validation/zod-utils';

export type PickupAuthorizationResponse = PickupAuthRow & {
  effectiveStatus: ReturnType<typeof computeEffectivePickupStatus>;
};

@Injectable()
export class PickupAuthorizationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly schoolAccess: SchoolAccessService,
  ) {}

  private assertResponsibleJwt(user: JwtPayload): asserts user is JwtPayload & {
    clientId: string;
    responsibleId: string;
  } {
    if (
      user.role !== 'responsible' ||
      !user.clientId ||
      !user.responsibleId
    ) {
      throw new ForbiddenException('Acesso apenas para conta de responsável.');
    }
  }

  private toResponse(row: PickupAuthRow): PickupAuthorizationResponse {
    const validUntil =
      row.validUntil instanceof Date
        ? row.validUntil
        : new Date(String(row.validUntil));
    return {
      ...row,
      effectiveStatus: computeEffectivePickupStatus({
        status: row.status,
        validUntil,
      }),
    };
  }

  private async expireStale(clientId: string) {
    await pickupQueries.pickupAuthExpireStaleActives(this.database.db, clientId);
  }

  async listForSchoolClient(
    user: JwtPayload,
    clientId: string,
    query: { studentId?: string; status?: string },
  ): Promise<PickupAuthorizationResponse[]> {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    await this.expireStale(clientId);
    const rows = await pickupQueries.pickupAuthListByClient(
      this.database.db,
      clientId,
      { studentId: query.studentId, status: query.status },
    );
    return rows.map((r) => this.toResponse(r));
  }

  async listForResponsible(user: JwtPayload): Promise<
    PickupAuthorizationResponse[]
  > {
    this.assertResponsibleJwt(user);
    await this.expireStale(user.clientId);
    const rows = await pickupQueries.pickupAuthListByResponsible(
      this.database.db,
      user.responsibleId,
      user.clientId,
    );
    return rows.map((r) => this.toResponse(r));
  }

  async createFromResponsible(user: JwtPayload, body: unknown) {
    this.assertResponsibleJwt(user);
    const parsed = createPickupAuthorizationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;

    const allowed = await studentsQueries.listStudentIdsForResponsible(
      this.database.db,
      user.responsibleId,
    );
    if (!allowed.includes(d.studentId)) {
      throw new BadRequestException(
        'Este aluno não está vinculado ao seu cadastro.',
      );
    }

    const student = await studentsQueries.getStudentById(
      this.database.db,
      d.studentId,
      user.clientId,
    );
    if (!student) {
      throw new BadRequestException('Aluno não encontrado.');
    }

    if (d.authorizedResponsibleId) {
      const other = await responsiblesQueries.getResponsibleById(
        this.database.db,
        d.authorizedResponsibleId,
        user.clientId,
      );
      if (!other) {
        throw new BadRequestException(
          'Responsável autorizado não encontrado nesta escola.',
        );
      }
    }

    try {
      const row = await pickupQueries.pickupAuthInsert(this.database.db, {
        clientId: user.clientId,
        studentId: d.studentId,
        requestedByResponsibleId: user.responsibleId,
        authorizedResponsibleId: d.authorizedResponsibleId,
        guestName: d.guestName,
        guestDocument: d.guestDocument,
        guestPhone: d.guestPhone,
        status: 'active',
        validFrom: d.validFrom,
        validUntil: d.validUntil,
        notes: d.notes ?? null,
        usedAt: null,
      });
      if (!row) {
        throw new BadRequestException('Não foi possível registrar.');
      }
      return this.toResponse(row);
    } catch {
      throw new BadRequestException(
        'Dados inconsistentes para autorização. Verifique se informou apenas responsável cadastrado ou apenas dados do convidado.',
      );
    }
  }

  async markUsedForSchool(
    user: JwtPayload,
    clientId: string,
    id: string,
  ): Promise<PickupAuthorizationResponse> {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    await this.expireStale(clientId);
    const row = await pickupQueries.pickupAuthGetById(
      this.database.db,
      id,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Autorização não encontrada.');
    }
    const status = computeEffectivePickupStatus({
      status: row.status,
      validUntil:
        row.validUntil instanceof Date
          ? row.validUntil
          : new Date(String(row.validUntil)),
    });
    if (status !== 'active') {
      throw new BadRequestException(
        'Só é possível marcar como usada quando a autorização está ativa e dentro da validade.',
      );
    }
    const updated = await pickupQueries.pickupAuthUpdateStatus(
      this.database.db,
      id,
      clientId,
      'used',
      { usedAt: new Date() },
    );
    if (!updated) {
      throw new NotFoundException('Autorização não encontrada.');
    }
    return this.toResponse(updated);
  }

  async cancelForSchool(
    user: JwtPayload,
    clientId: string,
    id: string,
  ): Promise<PickupAuthorizationResponse> {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    await this.expireStale(clientId);
    return this.cancelActive(id, clientId, null);
  }

  async cancelForResponsible(user: JwtPayload, id: string) {
    this.assertResponsibleJwt(user);
    await this.expireStale(user.clientId);
    return this.cancelActive(id, user.clientId, user.responsibleId);
  }

  private async cancelActive(
    id: string,
    clientId: string,
    onlyRequestedByResponsibleId: string | null,
  ): Promise<PickupAuthorizationResponse> {
    const row = await pickupQueries.pickupAuthGetById(
      this.database.db,
      id,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Autorização não encontrada.');
    }
    if (
      onlyRequestedByResponsibleId &&
      row.requestedByResponsibleId !== onlyRequestedByResponsibleId
    ) {
      throw new ForbiddenException('Esta autorização não foi criada por você.');
    }
    const status = computeEffectivePickupStatus({
      status: row.status,
      validUntil:
        row.validUntil instanceof Date
          ? row.validUntil
          : new Date(String(row.validUntil)),
    });
    if (status !== 'active') {
      throw new BadRequestException(
        'Somente autorizações ativas podem ser canceladas.',
      );
    }
    const updated = await pickupQueries.pickupAuthUpdateStatus(
      this.database.db,
      id,
      clientId,
      'cancelled',
      {},
    );
    if (!updated) {
      throw new NotFoundException('Autorização não encontrada.');
    }
    return this.toResponse(updated);
  }
}
