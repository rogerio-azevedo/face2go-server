import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as vehicleQueries from '../database/queries/vehicles.queries';
import type { VehicleWithDriverRow } from '../database/queries/vehicles.queries';
import { createVehicleSchema, updateVehicleSchema } from '../validation/vehicles.schema';
import { zodFirstMessage } from '../validation/zod-utils';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

export type VehicleDriverOptionDto = {
  id: string;
  name: string;
  relationshipType: string;
};

@Injectable()
export class VehiclesService {
  constructor(private readonly database: DatabaseService) {}

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

  private async householdResponsibleIds(
    user: JwtPayload & { clientId: string; responsibleId: string },
  ): Promise<string[]> {
    return responsiblesQueries.listHouseholdResponsibleIds(
      this.database.db,
      user.responsibleId,
      user.clientId,
    );
  }

  async listDriverOptions(user: JwtPayload): Promise<VehicleDriverOptionDto[]> {
    this.assertResponsibleJwt(user);
    return responsiblesQueries.listHouseholdDriverOptions(
      this.database.db,
      user.responsibleId,
      user.clientId,
    );
  }

  async listForResponsible(user: JwtPayload): Promise<VehicleWithDriverRow[]> {
    this.assertResponsibleJwt(user);
    const household = await this.householdResponsibleIds(user);
    return vehicleQueries.vehicleListForHousehold(
      this.database.db,
      household,
      user.clientId,
    );
  }

  async createFromResponsible(
    user: JwtPayload,
    body: unknown,
  ): Promise<VehicleWithDriverRow> {
    this.assertResponsibleJwt(user);
    const parsed = createVehicleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;

    const household = await this.householdResponsibleIds(user);
    if (!household.includes(d.driverResponsibleId)) {
      throw new BadRequestException(
        'Condutor inválido. Escolha um responsável vinculado aos mesmos alunos.',
      );
    }

    try {
      const row = await vehicleQueries.vehicleInsert(this.database.db, {
        clientId: user.clientId,
        responsibleId: d.driverResponsibleId,
        plate: d.plate,
        brand: d.brand,
        model: d.model,
        color: d.color,
      });
      if (!row) {
        throw new BadRequestException('Não foi possível cadastrar o veículo.');
      }
      const driver = await responsiblesQueries.getResponsibleById(
        this.database.db,
        row.responsibleId,
        user.clientId,
      );
      return {
        ...row,
        driverName: driver?.name ?? '',
      };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new BadRequestException(
          'Já existe um veículo com esta placa cadastrado nesta escola.',
        );
      }
      throw err;
    }
  }

  async updateFromResponsible(
    user: JwtPayload,
    id: string,
    body: unknown,
  ): Promise<VehicleWithDriverRow> {
    this.assertResponsibleJwt(user);
    const parsed = updateVehicleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;

    const household = await this.householdResponsibleIds(user);
    if (!household.includes(d.driverResponsibleId)) {
      throw new BadRequestException(
        'Condutor inválido. Escolha um responsável vinculado aos mesmos alunos.',
      );
    }

    try {
      const row = await vehicleQueries.vehicleUpdateForHousehold(
        this.database.db,
        id,
        user.clientId,
        household,
        {
          responsibleId: d.driverResponsibleId,
          plate: d.plate,
          brand: d.brand,
          model: d.model,
          color: d.color,
        },
      );
      if (!row) {
        throw new NotFoundException('Veículo não encontrado.');
      }
      const driver = await responsiblesQueries.getResponsibleById(
        this.database.db,
        row.responsibleId,
        user.clientId,
      );
      return {
        ...row,
        driverName: driver?.name ?? '',
      };
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }
      if (isUniqueViolation(err)) {
        throw new BadRequestException(
          'Já existe um veículo com esta placa cadastrado nesta escola.',
        );
      }
      throw err;
    }
  }

  async deleteForResponsible(user: JwtPayload, id: string): Promise<void> {
    this.assertResponsibleJwt(user);
    const household = await this.householdResponsibleIds(user);
    const deleted = await vehicleQueries.vehicleDeleteForHousehold(
      this.database.db,
      id,
      user.clientId,
      household,
    );
    if (!deleted) {
      throw new NotFoundException('Veículo não encontrado.');
    }
  }
}
