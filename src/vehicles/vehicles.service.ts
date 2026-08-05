import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as membersQueries from '../database/queries/members.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as peopleQueries from '../database/queries/people.queries';
import * as vehicleQueries from '../database/queries/vehicles.queries';
import type { VehicleWithDriverRow } from '../database/queries/vehicles.queries';
import {
  LprPlateSyncService,
  type SyncVehiclePlateResult,
} from '../lpr-plate-sync/lpr-plate-sync.service';
import { SchoolAccessService } from '../school-access/school-access.service';
import {
  buildPaginatedResult,
  parseListPaginationParams,
  type ListPaginationParams,
} from '../common/pagination';
import {
  createMemberVehicleSchema,
  updateMemberVehicleSchema,
} from '../validation/members.schema';
import {
  createVehicleSchema,
  updateVehicleSchema,
} from '../validation/vehicles.schema';
import { zodFirstMessage } from '../validation/zod-utils';

export type { VehicleWithDriverRow };

export type VehicleDto = VehicleWithDriverRow & { hasLprCameras: boolean };

const DUPLICATE_PLATE_MESSAGE =
  'Essa placa já está cadastrada no sistema, por favor procure o suporte.';

function getPostgresErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur; depth++) {
    if (
      typeof cur === 'object' &&
      cur !== null &&
      'code' in cur &&
      typeof (cur as { code?: unknown }).code === 'string'
    ) {
      return (cur as { code: string }).code;
    }
    cur =
      typeof cur === 'object' && cur !== null && 'cause' in cur
        ? (cur as { cause?: unknown }).cause
        : undefined;
  }
  return undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return getPostgresErrorCode(err) === '23505';
}

function normalizeVehiclePlateCmp(plate: string): string {
  return plate
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function vehicleRowWithLprSync(
  row: VehicleWithDriverRow,
  driverName: string,
  lpr: SyncVehiclePlateResult,
  hasLprCameras: boolean,
): VehicleDto {
  return {
    ...row,
    driverName,
    lprSyncStatus: lpr.lprSyncStatus,
    lprSyncError: lpr.lprSyncError,
    lprSyncedAt: lpr.lprSyncStatus === 'synced' ? new Date() : null,
    hasLprCameras,
  };
}

function attachHasLprCamerasToList(
  rows: VehicleWithDriverRow[],
  hasLprCameras: boolean,
): VehicleDto[] {
  return rows.map((row) => ({ ...row, hasLprCameras }));
}

export type VehicleDriverOptionDto = {
  id: string;
  name: string;
  relationshipType: string;
};

@Injectable()
export class VehiclesService {
  private readonly log = new Logger(VehiclesService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly schoolAccess: SchoolAccessService,
    private readonly lprPlateSync: LprPlateSyncService,
  ) {}

  /** Sincroniza placa nas câmeras LPR e devolve o veículo com status atualizado (cadastro/edição). */
  private async syncLprForVehicleRow(
    row: VehicleWithDriverRow,
    clientId: string,
    ownerDisplayName: string,
    logContext: string,
  ): Promise<VehicleDto> {
    const driverName = ownerDisplayName.trim() || 'CONDUTOR';
    const hasLprCameras = await this.lprPlateSync.hasActiveLprCameras(clientId);
    try {
      const lpr = await this.lprPlateSync.syncVehiclePlateOnCameras({
        clientId,
        vehicleId: row.id,
        plate: row.plate,
        ownerDisplayName: driverName,
        vehicleColor: row.color,
        logContext,
      });
      return vehicleRowWithLprSync(row, row.driverName || driverName, lpr, hasLprCameras);
    } catch (e) {
      this.log.warn(
        `${logContext}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return vehicleRowWithLprSync(row, row.driverName || driverName, {
        lprSyncStatus: 'sync_failed',
        lprSyncError:
          e instanceof Error
            ? e.message
            : 'Falha ao sincronizar placa com LPR.',
      }, hasLprCameras);
    }
  }

  private async syncLprAfterPlateChange(
    row: VehicleWithDriverRow,
    clientId: string,
    previousPlate: string,
    ownerDisplayName: string,
    logContext: string,
  ): Promise<VehicleDto> {
    const driverName = ownerDisplayName.trim() || 'CONDUTOR';
    const hasLprCameras = await this.lprPlateSync.hasActiveLprCameras(clientId);
    try {
      await this.lprPlateSync.removePlateFromAllLprCameras(
        clientId,
        previousPlate,
        `${logContext} remove-old`,
      );
      const lpr = await this.lprPlateSync.syncVehiclePlateOnCameras({
        clientId,
        vehicleId: row.id,
        plate: row.plate,
        ownerDisplayName: driverName,
        vehicleColor: row.color,
        logContext,
      });
      return vehicleRowWithLprSync(row, row.driverName || driverName, lpr, hasLprCameras);
    } catch (e) {
      this.log.warn(
        `${logContext}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return vehicleRowWithLprSync(row, row.driverName || driverName, {
        lprSyncStatus: 'sync_failed',
        lprSyncError:
          e instanceof Error
            ? e.message
            : 'Falha ao sincronizar placa com LPR.',
      }, hasLprCameras);
    }
  }

  private assertResponsibleJwt(user: JwtPayload): asserts user is JwtPayload & {
    clientId: string;
    responsibleId: string;
  } {
    if (user.role !== 'responsible' || !user.clientId || !user.responsibleId) {
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

  /** Copia veículos de outras escolas para vínculos locais da mesma pessoa (lazy backfill). */
  private async reconcileCrossClientVehiclesForUser(
    userId: string,
    clientId: string,
  ): Promise<void> {
    const owners = await peopleQueries.listVehicleOwnerIdsByUserIdAndClient(
      this.database.db,
      userId,
      clientId,
    );
    const targetResponsibleId = owners.responsibleIds[0];
    const targetMemberId = owners.memberIds[0];
    if (!targetResponsibleId && !targetMemberId) return;

    const sourceVehicles =
      await vehicleQueries.vehicleListByUserIdExcludingClient(
        this.database.db,
        userId,
        clientId,
      );
    if (sourceVehicles.length === 0) return;

    const currentVehicles = await vehicleQueries.vehicleListForOwnerBonds(
      this.database.db,
      clientId,
      owners.responsibleIds,
      owners.memberIds,
    );
    const localPlates = new Set(
      currentVehicles.map((v) => normalizeVehiclePlateCmp(v.plate)),
    );

    let driverName = 'Condutor';
    if (targetResponsibleId) {
      const r = await responsiblesQueries.getResponsibleById(
        this.database.db,
        targetResponsibleId,
        clientId,
      );
      driverName = r?.name ?? driverName;
    } else if (targetMemberId) {
      const m = await membersQueries.getMemberById(
        this.database.db,
        targetMemberId,
        clientId,
      );
      driverName = m?.name ?? driverName;
    }

    for (const source of sourceVehicles) {
      const plateNorm = normalizeVehiclePlateCmp(source.plate);
      if (localPlates.has(plateNorm)) continue;

      const existing = await vehicleQueries.vehicleFindByPlateInClient(
        this.database.db,
        clientId,
        source.plate,
      );
      if (existing) {
        this.log.warn(
          `Placa ${source.plate} já existe em clientId=${clientId} — skip cópia cross-client`,
        );
        continue;
      }

      try {
        const row = await vehicleQueries.vehicleInsert(this.database.db, {
          clientId,
          responsibleId: targetResponsibleId ?? null,
          memberId: targetResponsibleId ? null : targetMemberId,
          plate: source.plate.trim().toUpperCase(),
          brand: source.brand,
          model: source.model,
          color: source.color,
        });
        if (!row) continue;

        await this.syncLprForVehicleRow(
          { ...row, driverName },
          clientId,
          driverName,
          `cross-client-vehicle userId=${userId}`,
        );
        localPlates.add(plateNorm);
      } catch (e) {
        if (isUniqueViolation(e)) continue;
        this.log.warn(
          `Falha ao copiar veículo ${source.plate} para clientId=${clientId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  async listForResponsible(user: JwtPayload): Promise<VehicleDto[]> {
    this.assertResponsibleJwt(user);
    const household = await this.householdResponsibleIds(user);
    const hasLprCameras = await this.lprPlateSync.hasActiveLprCameras(
      user.clientId,
    );

    const self = await responsiblesQueries.getResponsibleById(
      this.database.db,
      user.responsibleId,
      user.clientId,
    );
    if (self?.userId) {
      await this.reconcileCrossClientVehiclesForUser(
        self.userId,
        user.clientId,
      );
      const owners = await peopleQueries.listVehicleOwnerIdsByUserIdAndClient(
        this.database.db,
        self.userId,
        user.clientId,
      );
      const responsibleIds = [
        ...new Set([...household, ...owners.responsibleIds]),
      ];
      const rows = await vehicleQueries.vehicleListForOwnerBonds(
        this.database.db,
        user.clientId,
        responsibleIds,
        owners.memberIds,
      );
      return attachHasLprCamerasToList(rows, hasLprCameras);
    }

    const rows = await vehicleQueries.vehicleListForHousehold(
      this.database.db,
      household,
      user.clientId,
    );
    return attachHasLprCamerasToList(rows, hasLprCameras);
  }

  async createFromResponsible(
    user: JwtPayload,
    body: unknown,
  ): Promise<VehicleDto> {
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
        row.responsibleId!,
        user.clientId,
      );
      const driverName = driver?.name ?? '';
      return this.syncLprForVehicleRow(
        { ...row, driverName },
        user.clientId,
        driverName,
        `create responsible vehicle=${row.id}`,
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new BadRequestException(DUPLICATE_PLATE_MESSAGE);
      }
      throw err;
    }
  }

  async updateFromResponsible(
    user: JwtPayload,
    id: string,
    body: unknown,
  ): Promise<VehicleDto> {
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
      const prev = await vehicleQueries.vehicleGetWithDriver(
        this.database.db,
        id,
        user.clientId,
      );
      if (!prev?.responsibleId || !household.includes(prev.responsibleId)) {
        throw new NotFoundException('Veículo não encontrado.');
      }

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
        row.responsibleId!,
        user.clientId,
      );

      const driverName = driver?.name ?? '';
      const withDriver = { ...row, driverName };
      const plateChanged =
        normalizeVehiclePlateCmp(prev.plate) !==
        normalizeVehiclePlateCmp(row.plate);
      if (plateChanged) {
        return this.syncLprAfterPlateChange(
          withDriver,
          user.clientId,
          prev.plate,
          driverName,
          `update plate responsible vehicle=${id}`,
        );
      }
      return this.syncLprForVehicleRow(
        withDriver,
        user.clientId,
        driverName,
        `update responsible vehicle=${id}`,
      );
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }
      if (isUniqueViolation(err)) {
        throw new BadRequestException(DUPLICATE_PLATE_MESSAGE);
      }
      throw err;
    }
  }

  async syncForResponsible(
    user: JwtPayload,
    id: string,
  ): Promise<SyncVehiclePlateResult> {
    this.assertResponsibleJwt(user);
    const household = await this.householdResponsibleIds(user);
    const v = await vehicleQueries.vehicleGetWithDriver(
      this.database.db,
      id,
      user.clientId,
    );
    if (!v?.responsibleId || !household.includes(v.responsibleId)) {
      throw new NotFoundException('Veículo não encontrado.');
    }
    return this.lprPlateSync.syncVehiclePlateOnCameras({
      clientId: user.clientId,
      vehicleId: id,
      plate: v.plate,
      ownerDisplayName: v.driverName ?? 'CONDUTOR',
      vehicleColor: v.color,
      logContext: `sync responsible vehicle=${id}`,
    });
  }

  async deleteForResponsible(user: JwtPayload, id: string): Promise<void> {
    this.assertResponsibleJwt(user);
    const household = await this.householdResponsibleIds(user);
    const existing = await vehicleQueries.vehicleGetWithDriver(
      this.database.db,
      id,
      user.clientId,
    );
    if (
      !existing?.responsibleId ||
      !household.includes(existing.responsibleId)
    ) {
      throw new NotFoundException('Veículo não encontrado.');
    }

    void this.lprPlateSync
      .removePlateFromAllLprCameras(
        user.clientId,
        existing.plate,
        `delete vehicle=${id}`,
      )
      .catch((e) =>
        this.log.warn(
          `LPR remove ao excluir veículo ${id}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );

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

  /** Gestão empresa / cliente escola na web — lista veículos do cliente (paginado). */
  async listVehiclesForCompanyClient(
    user: JwtPayload,
    clientId: string,
    query: ListPaginationParams = {},
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const { page, pageSize, search, offset } = parseListPaginationParams(
      query.page !== undefined ? String(query.page) : undefined,
      query.pageSize !== undefined ? String(query.pageSize) : undefined,
      query.search,
    );
    const [total, data, hasLprCameras] = await Promise.all([
      vehicleQueries.countVehiclesForClient(this.database.db, clientId, {
        search,
      }),
      vehicleQueries.vehicleListForClient(this.database.db, clientId, {
        search,
        offset,
        limit: pageSize,
      }),
      this.lprPlateSync.hasActiveLprCameras(clientId),
    ]);
    return buildPaginatedResult(
      attachHasLprCamerasToList(data, hasLprCameras),
      total,
      page,
      pageSize,
    );
  }

  async listDriverOptionsForCompanyClient(
    user: JwtPayload,
    clientId: string,
  ): Promise<VehicleDriverOptionDto[]> {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    return responsiblesQueries.listResponsibleDriverOptionsForClient(
      this.database.db,
      clientId,
    );
  }

  async createVehicleForCompanyClient(
    user: JwtPayload,
    clientId: string,
    body: unknown,
  ): Promise<VehicleDto> {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const parsed = createVehicleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;

    const driver = await responsiblesQueries.getResponsibleById(
      this.database.db,
      d.driverResponsibleId,
      clientId,
    );
    if (!driver) {
      throw new BadRequestException(
        'Condutor inválido. Escolha um responsável cadastrado nesta escola.',
      );
    }

    try {
      const row = await vehicleQueries.vehicleInsert(this.database.db, {
        clientId,
        responsibleId: d.driverResponsibleId,
        plate: d.plate,
        brand: d.brand,
        model: d.model,
        color: d.color,
      });
      if (!row) {
        throw new BadRequestException('Não foi possível cadastrar o veículo.');
      }

      const driverName = driver.name ?? '';
      return this.syncLprForVehicleRow(
        { ...row, driverName },
        clientId,
        driverName,
        `create company-client vehicle=${row.id}`,
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new BadRequestException(DUPLICATE_PLATE_MESSAGE);
      }
      throw err;
    }
  }

  async updateVehicleForCompanyClient(
    user: JwtPayload,
    clientId: string,
    id: string,
    body: unknown,
  ): Promise<VehicleDto> {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const parsed = updateVehicleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;

    const driver = await responsiblesQueries.getResponsibleById(
      this.database.db,
      d.driverResponsibleId,
      clientId,
    );
    if (!driver) {
      throw new BadRequestException(
        'Condutor inválido. Escolha um responsável cadastrado nesta escola.',
      );
    }

    try {
      const prev = await vehicleQueries.vehicleGetWithDriver(
        this.database.db,
        id,
        clientId,
      );
      if (!prev) {
        throw new NotFoundException('Veículo não encontrado.');
      }

      const row = await vehicleQueries.vehicleUpdateById(
        this.database.db,
        id,
        clientId,
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

      const driverName = driver.name ?? '';
      const withDriver = { ...row, driverName };
      const plateChanged =
        normalizeVehiclePlateCmp(prev.plate) !==
        normalizeVehiclePlateCmp(row.plate);
      if (plateChanged) {
        return this.syncLprAfterPlateChange(
          withDriver,
          clientId,
          prev.plate,
          driverName,
          `update plate company-client vehicle=${id}`,
        );
      }
      return this.syncLprForVehicleRow(
        withDriver,
        clientId,
        driverName,
        `update company-client vehicle=${id}`,
      );
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }
      if (isUniqueViolation(err)) {
        throw new BadRequestException(DUPLICATE_PLATE_MESSAGE);
      }
      throw err;
    }
  }

  async deleteVehicleForCompanyClient(
    user: JwtPayload,
    clientId: string,
    id: string,
  ): Promise<void> {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const existing = await vehicleQueries.vehicleGetWithDriver(
      this.database.db,
      id,
      clientId,
    );
    if (!existing) {
      throw new NotFoundException('Veículo não encontrado.');
    }

    void this.lprPlateSync
      .removePlateFromAllLprCameras(
        clientId,
        existing.plate,
        `delete vehicle=${id}`,
      )
      .catch((e) =>
        this.log.warn(
          `LPR remove ao excluir veículo ${id}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );

    const deleted = await vehicleQueries.vehicleDeleteById(
      this.database.db,
      id,
      clientId,
    );
    if (!deleted) {
      throw new NotFoundException('Veículo não encontrado.');
    }
  }

  private assertMemberJwt(user: JwtPayload): asserts user is JwtPayload & {
    clientId: string;
    memberId: string;
  } {
    if (user.role !== 'member' || !user.clientId || !user.memberId) {
      throw new ForbiddenException('Acesso apenas para conta de membro.');
    }
  }

  async listForMember(user: JwtPayload): Promise<VehicleDto[]> {
    this.assertMemberJwt(user);
    const hasLprCameras = await this.lprPlateSync.hasActiveLprCameras(
      user.clientId,
    );

    const self = await vehicleQueries.vehicleGetMemberName(
      this.database.db,
      user.memberId,
      user.clientId,
    );
    const memberRow = await membersQueries.getMemberById(
      this.database.db,
      user.memberId,
      user.clientId,
    );

    if (memberRow?.userId) {
      await this.reconcileCrossClientVehiclesForUser(
        memberRow.userId,
        user.clientId,
      );
      const owners = await peopleQueries.listVehicleOwnerIdsByUserIdAndClient(
        this.database.db,
        memberRow.userId,
        user.clientId,
      );
      const rows = await vehicleQueries.vehicleListForOwnerBonds(
        this.database.db,
        user.clientId,
        owners.responsibleIds,
        [...new Set([user.memberId, ...owners.memberIds])],
      );
      return attachHasLprCamerasToList(rows, hasLprCameras);
    }

    if (!self) {
      return [];
    }

    const rows = await vehicleQueries.vehicleListForMember(
      this.database.db,
      user.memberId,
      user.clientId,
    );
    return attachHasLprCamerasToList(rows, hasLprCameras);
  }

  async createFromMember(
    user: JwtPayload,
    body: unknown,
  ): Promise<VehicleDto> {
    this.assertMemberJwt(user);
    const parsed = createMemberVehicleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;

    const member = await vehicleQueries.vehicleGetMemberName(
      this.database.db,
      user.memberId,
      user.clientId,
    );
    if (!member) {
      throw new NotFoundException('Membro não encontrado.');
    }

    try {
      const row = await vehicleQueries.vehicleInsert(this.database.db, {
        clientId: user.clientId,
        memberId: user.memberId,
        plate: d.plate,
        brand: d.brand,
        model: d.model,
        color: d.color,
      });
      if (!row) {
        throw new BadRequestException('Não foi possível cadastrar o veículo.');
      }
      return this.syncLprForVehicleRow(
        { ...row, driverName: member.name },
        user.clientId,
        member.name,
        `create member vehicle=${row.id}`,
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new BadRequestException(DUPLICATE_PLATE_MESSAGE);
      }
      throw err;
    }
  }

  async updateFromMember(
    user: JwtPayload,
    id: string,
    body: unknown,
  ): Promise<VehicleDto> {
    this.assertMemberJwt(user);
    const parsed = updateMemberVehicleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    if (
      d.plate === undefined &&
      d.brand === undefined &&
      d.model === undefined &&
      d.color === undefined
    ) {
      throw new BadRequestException('Nada para atualizar.');
    }

    const prev = await vehicleQueries.vehicleGetWithDriver(
      this.database.db,
      id,
      user.clientId,
    );
    if (!prev || prev.memberId !== user.memberId) {
      throw new NotFoundException('Veículo não encontrado.');
    }

    const member = await vehicleQueries.vehicleGetMemberName(
      this.database.db,
      user.memberId,
      user.clientId,
    );
    if (!member) {
      throw new NotFoundException('Membro não encontrado.');
    }

    try {
      const updated = await vehicleQueries.vehicleUpdateForMember(
        this.database.db,
        id,
        user.clientId,
        user.memberId,
        {
          plate: d.plate ?? prev.plate,
          brand: d.brand ?? prev.brand,
          model: d.model ?? prev.model,
          color: d.color ?? prev.color,
        },
      );
      if (!updated) {
        throw new NotFoundException('Veículo não encontrado.');
      }

      const plateChanged =
        normalizeVehiclePlateCmp(updated.plate) !==
        normalizeVehiclePlateCmp(prev.plate);

      if (plateChanged) {
        return this.syncLprAfterPlateChange(
          { ...updated, driverName: member.name },
          user.clientId,
          prev.plate,
          member.name,
          `update member vehicle=${id}`,
        );
      }

      const hasLprCameras = await this.lprPlateSync.hasActiveLprCameras(
        user.clientId,
      );
      return { ...updated, driverName: member.name, hasLprCameras };
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }
      if (isUniqueViolation(err)) {
        throw new BadRequestException(DUPLICATE_PLATE_MESSAGE);
      }
      throw err;
    }
  }

  async syncForMember(
    user: JwtPayload,
    id: string,
  ): Promise<VehicleDto> {
    this.assertMemberJwt(user);
    const row = await vehicleQueries.vehicleGetWithDriver(
      this.database.db,
      id,
      user.clientId,
    );
    if (!row || row.memberId !== user.memberId) {
      throw new NotFoundException('Veículo não encontrado.');
    }
    const member = await vehicleQueries.vehicleGetMemberName(
      this.database.db,
      user.memberId,
      user.clientId,
    );
    if (!member) {
      throw new NotFoundException('Membro não encontrado.');
    }
    return this.syncLprForVehicleRow(
      row,
      user.clientId,
      member.name,
      `sync member vehicle=${id}`,
    );
  }

  async deleteForMember(user: JwtPayload, id: string): Promise<void> {
    this.assertMemberJwt(user);
    const existing = await vehicleQueries.vehicleGetWithDriver(
      this.database.db,
      id,
      user.clientId,
    );
    if (!existing || existing.memberId !== user.memberId) {
      throw new NotFoundException('Veículo não encontrado.');
    }

    void this.lprPlateSync
      .removePlateFromAllLprCameras(
        user.clientId,
        existing.plate,
        `delete member vehicle=${id}`,
      )
      .catch((e) =>
        this.log.warn(
          `LPR remove ao excluir veículo ${id}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );

    const deleted = await vehicleQueries.vehicleDeleteForMember(
      this.database.db,
      id,
      user.clientId,
      user.memberId,
    );
    if (!deleted) {
      throw new NotFoundException('Veículo não encontrado.');
    }
  }
}
