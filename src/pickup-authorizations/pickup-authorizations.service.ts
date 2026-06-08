import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { randomLinkCode } from '../common/utils/link-code';
import * as clientsQueries from '../database/queries/clients.queries';
import * as pickupQueries from '../database/queries/pickup-authorizations.queries';
import type { PickupAuthRow } from '../database/queries/pickup-authorizations.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import * as studentsQueries from '../database/queries/students.queries';
import { DatabaseService } from '../database/database.service';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { ALWAYS_TIME_ZONE_INDEX } from '../face-sync/intelbras-time-zone.constants';
import { LprPlateSyncService } from '../lpr-plate-sync/lpr-plate-sync.service';
import { SchoolAccessService } from '../school-access/school-access.service';
import { R2StorageService } from '../storage/r2-storage.service';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import {
  computeEffectivePickupStatus,
  createPickupAuthorizationSchema,
  updatePickupAuthorizationSchema,
} from '../validation/pickup-authorizations.schema';
import { zodFirstMessage } from '../validation/zod-utils';

export type PickupAuthorizationStudentDto = {
  studentId: string;
  name: string;
};

export type PickupAuthorizationVehicleDto = {
  plate: string;
  brand: string;
  model: string;
  color: string;
  lprSyncStatus: PickupAuthRow['guestVehicleLprSyncStatus'];
  lprSyncedAt: Date | null;
  lprSyncError: string | null;
} | null;

export type PickupAuthorizationResponse = PickupAuthRow & {
  effectiveStatus: ReturnType<typeof computeEffectivePickupStatus>;
  students: PickupAuthorizationStudentDto[];
  vehicle: PickupAuthorizationVehicleDto;
  guestRegistrationUrl: string | null;
  linkedResponsibleName: string | null;
  authorizedPhotoUrl: string | null;
};

type LinkedResponsibleRow = NonNullable<
  Awaited<ReturnType<typeof responsiblesQueries.getResponsibleById>>
>;

@Injectable()
export class PickupAuthorizationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly schoolAccess: SchoolAccessService,
    private readonly configService: ConfigService,
    private readonly r2: R2StorageService,
    private readonly faceSync: FaceSyncService,
    private readonly lprPlateSync: LprPlateSyncService,
  ) {}

  private assertResponsibleJwt(user: JwtPayload): asserts user is JwtPayload & {
    clientId: string;
    responsibleId: string;
  } {
    if (user.role !== 'responsible' || !user.clientId || !user.responsibleId) {
      throw new ForbiddenException('Acesso apenas para conta de responsável.');
    }
  }

  private frontendRetiradaUrl(code: string): string {
    const base = this.configService.get<string>('FRONTEND_URL') ?? '';
    const trimmed = base.replace(/\/$/, '');
    return `${trimmed}/retirada/${code}`;
  }

  private async enrichRows(
    rows: PickupAuthRow[],
  ): Promise<PickupAuthorizationResponse[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const links = await pickupQueries.pickupAuthListStudentsForAuthIds(
      this.database.db,
      ids,
    );
    const byAuth = new Map<string, PickupAuthorizationStudentDto[]>();
    for (const link of links) {
      const list = byAuth.get(link.authorizationId) ?? [];
      list.push({ studentId: link.studentId, name: link.studentName });
      byAuth.set(link.authorizationId, list);
    }

    const linkedIds = [
      ...new Set(
        rows
          .map((r) => r.linkedResponsibleId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const linkedInfoById = new Map<
      string,
      { name: string; photoKey: string | null }
    >();
    if (linkedIds.length > 0) {
      await Promise.all(
        linkedIds.map(async (id) => {
          const row = rows.find((r) => r.linkedResponsibleId === id);
          if (!row) return;
          const responsible = await responsiblesQueries.getResponsibleById(
            this.database.db,
            id,
            row.clientId,
          );
          if (responsible) {
            linkedInfoById.set(id, {
              name: responsible.name,
              photoKey: responsible.photoKey ?? null,
            });
          }
        }),
      );
    }

    return Promise.all(
      rows.map(async (row) => {
        const linked = row.linkedResponsibleId
          ? linkedInfoById.get(row.linkedResponsibleId)
          : null;
        const authorizedPhotoUrl = await this.resolveAuthorizedPhotoUrl(
          row,
          linked?.photoKey ?? null,
        );
        return this.toResponse(
          row,
          byAuth.get(row.id) ?? [],
          linked?.name ?? null,
          authorizedPhotoUrl,
        );
      }),
    );
  }

  private async resolveAuthorizedPhotoUrl(
    row: PickupAuthRow,
    linkedPhotoKey: string | null,
  ): Promise<string | null> {
    const photoKey = linkedPhotoKey?.trim()
      ? linkedPhotoKey.trim()
      : row.guestFaceImageKey?.trim()
        ? row.guestFaceImageKey.trim()
        : null;
    if (!photoKey) return null;
    if (
      !row.linkedResponsibleId &&
      (row.guestApprovalStatus === 'pending_face' ||
        row.guestApprovalStatus === 'rejected')
    ) {
      return null;
    }
    return this.r2.createPresignedPortraitGetUrl(photoKey);
  }

  private async toResponseWithPhoto(
    row: PickupAuthRow,
    students: PickupAuthorizationStudentDto[],
    linkedResponsibleName: string | null = null,
    linkedPhotoKey: string | null = null,
  ): Promise<PickupAuthorizationResponse> {
    let name = linkedResponsibleName;
    let photoKey = linkedPhotoKey;
    if (row.linkedResponsibleId) {
      const linked = await responsiblesQueries.getResponsibleById(
        this.database.db,
        row.linkedResponsibleId,
        row.clientId,
      );
      name = name ?? linked?.name ?? null;
      photoKey = photoKey ?? linked?.photoKey ?? null;
    }
    const authorizedPhotoUrl = await this.resolveAuthorizedPhotoUrl(
      row,
      photoKey,
    );
    return this.toResponse(row, students, name, authorizedPhotoUrl);
  }

  private toResponse(
    row: PickupAuthRow,
    students: PickupAuthorizationStudentDto[],
    linkedResponsibleName: string | null = null,
    authorizedPhotoUrl: string | null = null,
  ): PickupAuthorizationResponse {
    const validUntil =
      row.validUntil instanceof Date
        ? row.validUntil
        : new Date(String(row.validUntil));
    const hasVehicle = !!row.guestVehiclePlate?.trim();
    return {
      ...row,
      effectiveStatus: computeEffectivePickupStatus({
        status: row.status,
        validUntil,
      }),
      students,
      vehicle: hasVehicle
        ? {
            plate: row.guestVehiclePlate!,
            brand: row.guestVehicleBrand ?? '',
            model: row.guestVehicleModel ?? '',
            color: row.guestVehicleColor ?? '',
            lprSyncStatus: row.guestVehicleLprSyncStatus ?? null,
            lprSyncedAt: row.guestVehicleLprSyncedAt ?? null,
            lprSyncError: row.guestVehicleLprSyncError ?? null,
          }
        : null,
      guestRegistrationUrl: row.guestLinkCode
        ? this.frontendRetiradaUrl(row.guestLinkCode)
        : null,
      linkedResponsibleName,
      authorizedPhotoUrl,
    };
  }

  async lookupGuestResponsible(user: JwtPayload, document: string) {
    this.assertResponsibleJwt(user);
    const normalized = document.replace(/\D/g, '') || document.trim();
    if (!normalized) {
      throw new BadRequestException('Informe um documento válido.');
    }

    const responsible =
      await responsiblesQueries.findResponsibleByDocumentAndClient(
        this.database.db,
        user.clientId,
        normalized,
      );
    if (!responsible || !responsible.isActive) {
      return null;
    }
    if (responsible.id === user.responsibleId) {
      return null;
    }

    let photoUrl: string | null = null;
    if (responsible.photoKey) {
      photoUrl = await this.r2.createPresignedPortraitGetUrl(
        responsible.photoKey,
      );
    }

    return {
      id: responsible.id,
      name: responsible.name,
      document: responsible.document,
      photoUrl,
    };
  }

  private async assertLinkedResponsible(
    clientId: string,
    linkedResponsibleId: string,
    requestedByResponsibleId: string,
  ): Promise<LinkedResponsibleRow> {
    if (linkedResponsibleId === requestedByResponsibleId) {
      throw new BadRequestException(
        'Não é possível vincular você mesmo como retirante.',
      );
    }
    const linked = await responsiblesQueries.getResponsibleById(
      this.database.db,
      linkedResponsibleId,
      clientId,
    );
    if (!linked || !linked.isActive) {
      throw new BadRequestException('Responsável vinculado não encontrado.');
    }
    return linked;
  }

  private linkedResponsibleApprovalPatch(linked: LinkedResponsibleRow) {
    return {
      guestApprovalStatus: 'approved' as const,
      guestFaceId: linked.faceId ?? null,
      guestFaceImageKey: linked.photoKey ?? null,
      guestFaceSyncStatus: linked.deviceSyncStatus ?? null,
      guestFaceSyncedAt: linked.deviceSyncedAt ?? null,
      guestFaceSyncError: linked.deviceSyncError ?? null,
    };
  }

  private async expireStale(clientId: string) {
    await pickupQueries.pickupAuthExpireStaleActives(
      this.database.db,
      clientId,
    );
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
    return this.enrichRows(rows);
  }

  async listForResponsible(
    user: JwtPayload,
  ): Promise<PickupAuthorizationResponse[]> {
    this.assertResponsibleJwt(user);
    await this.expireStale(user.clientId);
    const rows = await pickupQueries.pickupAuthListByResponsible(
      this.database.db,
      user.responsibleId,
      user.clientId,
    );
    return this.enrichRows(rows);
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
    for (const sid of d.studentIds) {
      if (!allowed.includes(sid)) {
        throw new BadRequestException(
          'Um ou mais alunos não estão vinculados ao seu cadastro.',
        );
      }
    }

    const existingActive =
      await pickupQueries.pickupAuthFindActiveByGuestDocumentForRequester(
        this.database.db,
        user.clientId,
        user.responsibleId,
        d.guestDocument,
      );
    if (existingActive) {
      throw new BadRequestException(
        'Já existe uma autorização ativa para este documento. Edite ou renove a autorização existente.',
      );
    }

    let linked: LinkedResponsibleRow | undefined;
    if (d.linkedResponsibleId) {
      linked = await this.assertLinkedResponsible(
        user.clientId,
        d.linkedResponsibleId,
        user.responsibleId,
      );
    }

    const vehiclePatch = d.vehicle
      ? {
          guestVehiclePlate: d.vehicle.plate,
          guestVehicleBrand: d.vehicle.brand,
          guestVehicleModel: d.vehicle.model,
          guestVehicleColor: d.vehicle.color,
          guestVehicleLprSyncStatus: 'pending_sync' as const,
        }
      : {};

    try {
      const row = await pickupQueries.pickupAuthInsertWithStudents(
        this.database.db,
        {
          clientId: user.clientId,
          requestedByResponsibleId: user.responsibleId,
          linkedResponsibleId: d.linkedResponsibleId,
          guestName: linked?.name ?? d.guestName,
          guestDocument: linked?.document ?? d.guestDocument,
          guestPhone: d.guestPhone,
          guestApprovalStatus: linked ? 'approved' : 'pending_face',
          status: 'active',
          validFrom: d.validFrom,
          validUntil: d.validUntil,
          notes: d.notes ?? null,
          usedAt: null,
          ...(linked ? this.linkedResponsibleApprovalPatch(linked) : {}),
          ...vehiclePatch,
        },
        d.studentIds,
      );
      if (!row) {
        throw new BadRequestException('Não foi possível registrar.');
      }
      const students = await pickupQueries.pickupAuthListStudentsForAuth(
        this.database.db,
        row.id,
      );
      return this.toResponseWithPhoto(
        row,
        students.map((s) => ({ studentId: s.studentId, name: s.studentName })),
        linked?.name ?? null,
        linked?.photoKey ?? null,
      );
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        'Não foi possível registrar a autorização.',
      );
    }
  }

  async updateForResponsible(user: JwtPayload, id: string, body: unknown) {
    this.assertResponsibleJwt(user);
    const parsed = updatePickupAuthorizationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;

    const row = await this.assertOwnedAuth(
      id,
      user.clientId,
      user.responsibleId,
    );
    const effectiveStatus = computeEffectivePickupStatus({
      status: row.status,
      validUntil:
        row.validUntil instanceof Date
          ? row.validUntil
          : new Date(String(row.validUntil)),
    });

    const canEditActive = effectiveStatus === 'active';
    const canRenew =
      effectiveStatus === 'cancelled' || effectiveStatus === 'expired';
    if (!canEditActive && !canRenew) {
      throw new BadRequestException(
        'Somente autorizações ativas podem ser editadas ou renovadas.',
      );
    }

    if (d.studentIds?.length) {
      const allowed = await studentsQueries.listStudentIdsForResponsible(
        this.database.db,
        user.responsibleId,
      );
      for (const sid of d.studentIds) {
        if (!allowed.includes(sid)) {
          throw new BadRequestException(
            'Um ou mais alunos não estão vinculados ao seu cadastro.',
          );
        }
      }
    }

    let linked: LinkedResponsibleRow | undefined;
    if (d.linkedResponsibleId) {
      linked = await this.assertLinkedResponsible(
        user.clientId,
        d.linkedResponsibleId,
        user.responsibleId,
      );
    } else if (d.linkedResponsibleId === null) {
      linked = undefined;
    } else if (row.linkedResponsibleId) {
      const existing = await responsiblesQueries.getResponsibleById(
        this.database.db,
        row.linkedResponsibleId,
        user.clientId,
      );
      linked = existing ?? undefined;
    }

    const vehiclePatch =
      d.vehicle === null
        ? {
            guestVehiclePlate: null,
            guestVehicleBrand: null,
            guestVehicleModel: null,
            guestVehicleColor: null,
            guestVehicleLprSyncStatus: null,
            guestVehicleLprSyncedAt: null,
            guestVehicleLprSyncError: null,
          }
        : d.vehicle
          ? {
              guestVehiclePlate: d.vehicle.plate,
              guestVehicleBrand: d.vehicle.brand,
              guestVehicleModel: d.vehicle.model,
              guestVehicleColor: d.vehicle.color,
              guestVehicleLprSyncStatus: 'pending_sync' as const,
            }
          : {};

    const updated = await pickupQueries.pickupAuthUpdate(
      this.database.db,
      id,
      user.clientId,
      {
        ...(canRenew
          ? {
              status: 'active' as const,
              usedAt: null,
            }
          : {}),
        ...(d.guestName !== undefined ? { guestName: d.guestName } : {}),
        ...(d.guestDocument !== undefined
          ? { guestDocument: d.guestDocument }
          : {}),
        ...(d.guestPhone !== undefined ? { guestPhone: d.guestPhone } : {}),
        ...(d.validFrom !== undefined ? { validFrom: d.validFrom } : {}),
        ...(d.validUntil !== undefined ? { validUntil: d.validUntil } : {}),
        ...(d.notes !== undefined ? { notes: d.notes } : {}),
        ...(d.linkedResponsibleId !== undefined
          ? { linkedResponsibleId: d.linkedResponsibleId }
          : {}),
        ...(linked ? this.linkedResponsibleApprovalPatch(linked) : {}),
        ...vehiclePatch,
      },
    );
    if (!updated) {
      throw new NotFoundException('Autorização não encontrada.');
    }

    if (d.studentIds?.length) {
      await pickupQueries.pickupAuthReplaceStudents(
        this.database.db,
        id,
        d.studentIds,
      );
    }

    const students = await pickupQueries.pickupAuthListStudentsForAuth(
      this.database.db,
      id,
    );
    return this.toResponseWithPhoto(
      updated,
      students.map((s) => ({ studentId: s.studentId, name: s.studentName })),
      linked?.name ?? null,
      linked?.photoKey ?? null,
    );
  }

  async deleteForResponsible(user: JwtPayload, id: string) {
    this.assertResponsibleJwt(user);
    await this.expireStale(user.clientId);
    const deleted = await pickupQueries.pickupAuthDelete(
      this.database.db,
      id,
      user.clientId,
      user.responsibleId,
    );
    if (!deleted) {
      throw new BadRequestException(
        'Somente autorizações canceladas ou expiradas podem ser excluídas.',
      );
    }
    return { ok: true };
  }

  async deleteForSchool(user: JwtPayload, clientId: string, id: string) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    await this.expireStale(clientId);
    const deleted = await pickupQueries.pickupAuthDelete(
      this.database.db,
      id,
      clientId,
    );
    if (!deleted) {
      throw new BadRequestException(
        'Somente autorizações canceladas ou expiradas podem ser excluídas.',
      );
    }
    return { ok: true };
  }

  async generateGuestLink(user: JwtPayload, id: string) {
    this.assertResponsibleJwt(user);
    const row = await this.assertOwnedAuth(
      id,
      user.clientId,
      user.responsibleId,
    );
    if (row.guestLinkCode) {
      return {
        code: row.guestLinkCode,
        registrationUrl: this.frontendRetiradaUrl(row.guestLinkCode),
      };
    }

    let code = '';
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = randomLinkCode();
      const taken = await pickupQueries.isGuestLinkCodeTaken(
        this.database.db,
        candidate,
      );
      if (!taken) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      throw new BadRequestException('Não foi possível gerar o código do link.');
    }

    const updated = await pickupQueries.pickupAuthUpdateGuestLinkCode(
      this.database.db,
      id,
      user.clientId,
      code,
    );
    if (!updated) {
      throw new NotFoundException('Autorização não encontrada.');
    }
    return {
      code,
      registrationUrl: this.frontendRetiradaUrl(code),
    };
  }

  async getGuestFacePreviewUrl(user: JwtPayload, id: string) {
    this.assertResponsibleJwt(user);
    const row = await this.assertOwnedAuth(
      id,
      user.clientId,
      user.responsibleId,
    );
    if (!row.guestFaceImageKey) {
      throw new BadRequestException('O convidado ainda não enviou a foto.');
    }
    const url = await this.r2.createPresignedPortraitGetUrl(
      row.guestFaceImageKey,
    );
    if (!url) {
      throw new BadRequestException(
        'Não foi possível carregar a prévia da foto.',
      );
    }
    return { url };
  }

  async approveGuestFace(user: JwtPayload, id: string) {
    this.assertResponsibleJwt(user);
    const row = await this.assertOwnedAuth(
      id,
      user.clientId,
      user.responsibleId,
    );
    if (row.guestApprovalStatus !== 'submitted') {
      throw new BadRequestException(
        'Só é possível aprovar após o convidado enviar a foto.',
      );
    }
    if (!row.guestFaceImageKey) {
      throw new BadRequestException('Foto do convidado não encontrada.');
    }

    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      user.clientId,
    );
    if (!client) {
      throw new BadRequestException('Cliente não encontrado.');
    }

    const { buffer } = await this.r2.getObjectBytes(row.guestFaceImageKey);
    const faceId = await registrationsQueries.bumpClientFaceCounter(
      this.database.db,
      user.clientId,
    );

    const sync = await this.faceSync.syncPersonOnReaders({
      clientId: user.clientId,
      faceId,
      name: row.guestName,
      imageBuffer: buffer,
      timeSectionIds: [ALWAYS_TIME_ZONE_INDEX],
      logContext: `pickup-guest=${id}`,
    });

    let lprResult: {
      lprSyncStatus: 'pending_sync' | 'synced' | 'sync_failed';
      lprSyncError: string | null;
    } | null = null;
    if (row.guestVehiclePlate?.trim()) {
      lprResult = await this.lprPlateSync.pushPlateToLprCameras({
        clientId: user.clientId,
        plate: row.guestVehiclePlate,
        ownerDisplayName: row.guestName,
        vehicleColor: row.guestVehicleColor,
        logContext: `pickup-guest=${id}`,
      });
    }

    const updated = await pickupQueries.pickupAuthUpdateGuestApproval(
      this.database.db,
      id,
      user.clientId,
      {
        guestApprovalStatus: 'approved',
        guestFaceId: faceId,
        guestFaceSyncStatus: sync.deviceSyncStatus,
        guestFaceSyncedAt:
          sync.deviceSyncStatus === 'synced' ? new Date() : null,
        guestFaceSyncError: sync.deviceSyncError,
        ...(lprResult
          ? {
              guestVehicleLprSyncStatus: lprResult.lprSyncStatus,
              guestVehicleLprSyncedAt:
                lprResult.lprSyncStatus === 'synced' ? new Date() : null,
              guestVehicleLprSyncError: lprResult.lprSyncError,
            }
          : {}),
      },
    );
    if (!updated) {
      throw new NotFoundException('Autorização não encontrada.');
    }
    const students = await pickupQueries.pickupAuthListStudentsForAuth(
      this.database.db,
      id,
    );
    return this.toResponseWithPhoto(
      updated,
      students.map((s) => ({ studentId: s.studentId, name: s.studentName })),
    );
  }

  async rejectGuestFace(user: JwtPayload, id: string) {
    this.assertResponsibleJwt(user);
    const row = await this.assertOwnedAuth(
      id,
      user.clientId,
      user.responsibleId,
    );
    if (row.guestApprovalStatus !== 'submitted') {
      throw new BadRequestException(
        'Só é possível recusar após o convidado enviar a foto.',
      );
    }
    const updated = await pickupQueries.pickupAuthUpdateGuestApproval(
      this.database.db,
      id,
      user.clientId,
      {
        guestApprovalStatus: 'rejected',
        guestFaceImageKey: null,
        guestFaceId: null,
        guestFaceSyncStatus: null,
        guestFaceSyncedAt: null,
        guestFaceSyncError: null,
      },
    );
    if (!updated) {
      throw new NotFoundException('Autorização não encontrada.');
    }
    const students = await pickupQueries.pickupAuthListStudentsForAuth(
      this.database.db,
      id,
    );
    return this.toResponseWithPhoto(
      updated,
      students.map((s) => ({ studentId: s.studentId, name: s.studentName })),
    );
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
    const students = await pickupQueries.pickupAuthListStudentsForAuth(
      this.database.db,
      id,
    );
    return this.toResponseWithPhoto(
      updated,
      students.map((s) => ({ studentId: s.studentId, name: s.studentName })),
    );
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
    const students = await pickupQueries.pickupAuthListStudentsForAuth(
      this.database.db,
      id,
    );
    return this.toResponseWithPhoto(
      updated,
      students.map((s) => ({ studentId: s.studentId, name: s.studentName })),
    );
  }

  private async assertOwnedAuth(
    id: string,
    clientId: string,
    responsibleId: string,
  ): Promise<PickupAuthRow> {
    const row = await pickupQueries.pickupAuthGetById(
      this.database.db,
      id,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Autorização não encontrada.');
    }
    if (row.requestedByResponsibleId !== responsibleId) {
      throw new ForbiddenException('Esta autorização não foi criada por você.');
    }
    return row;
  }

  /** Usado pelo fluxo público de cadastro de face do convidado. */
  async getAuthByGuestLinkCode(code: string) {
    const row = await pickupQueries.pickupAuthGetByGuestLinkCode(
      this.database.db,
      code.trim(),
    );
    if (!row) return null;
    const status = computeEffectivePickupStatus({
      status: row.status,
      validUntil:
        row.validUntil instanceof Date
          ? row.validUntil
          : new Date(String(row.validUntil)),
    });
    if (status !== 'active') return null;
    return row;
  }

  async buildGuestFaceKeyForUpload(
    authorizationId: string,
    clientId: string,
    ext: string,
  ): Promise<string> {
    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      clientId,
    );
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    return this.r2.buildPickupGuestFaceKey(
      client.companyId,
      clientId,
      authorizationId,
      ext,
    );
  }
}
