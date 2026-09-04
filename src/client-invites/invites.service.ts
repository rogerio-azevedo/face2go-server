import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { z } from 'zod';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { randomLinkCode } from '../common/utils/link-code';
import * as clientsQueries from '../database/queries/clients.queries';
import * as inviteQueries from '../database/queries/client-invites.queries';
import type { ClientInviteRow } from '../database/queries/client-invites.queries';
import * as membersQueries from '../database/queries/members.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import { DatabaseService } from '../database/database.service';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { storeReaderFaceVariants } from '../face-sync/face-image-variants';
import { ALWAYS_TIME_ZONE_INDEX } from '../face-sync/intelbras-time-zone.constants';
import { LprPlateSyncService } from '../lpr-plate-sync/lpr-plate-sync.service';
import { SchoolAccessService } from '../school-access/school-access.service';
import { isPortraitImageUsable } from '../storage/portrait-image.utils';
import { R2StorageService } from '../storage/r2-storage.service';
import {
  computeEffectiveVisitorInviteStatus,
  createVisitorInviteSchema,
  updateVisitorInviteSchema,
} from '../validation/visitor-invites.schema';
import { zodFirstMessage } from '../validation/zod-utils';
import {
  INVITE_GUEST_FACE_APPROVED,
  INVITE_GUEST_FACE_SYNCED,
  type InviteGuestFaceApprovedPayload,
  type InviteGuestFaceSyncedPayload,
} from '../notifications/notifications.events';

export type InviteVehicleDto = {
  plate: string;
  brand: string;
  model: string;
  color: string;
  lprSyncStatus: ClientInviteRow['guestVehicleLprSyncStatus'];
  lprSyncedAt: Date | null;
  lprSyncError: string | null;
} | null;

export type InviteResponse = ClientInviteRow & {
  effectiveStatus: ReturnType<typeof computeEffectiveVisitorInviteStatus>;
  vehicle: InviteVehicleDto;
  guestRegistrationUrl: string | null;
  authorizedPhotoUrl: string | null;
  requestedByMemberName: string | null;
};

@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly schoolAccess: SchoolAccessService,
    private readonly configService: ConfigService,
    private readonly r2: R2StorageService,
    private readonly faceSync: FaceSyncService,
    private readonly lprPlateSync: LprPlateSyncService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private assertMemberJwt(user: JwtPayload): asserts user is JwtPayload & {
    clientId: string;
    memberId: string;
  } {
    if (user.role !== 'member' || !user.clientId || !user.memberId) {
      throw new ForbiddenException('Acesso apenas para conta de membro.');
    }
  }

  private frontendConviteUrl(code: string): string {
    const base = this.configService.get<string>('FRONTEND_URL') ?? '';
    const trimmed = base.replace(/\/$/, '');
    return `${trimmed}/convite/${code}`;
  }

  private async resolveAuthorizedPhotoUrl(
    row: ClientInviteRow,
  ): Promise<string | null> {
    const photoKey = row.guestFaceImageKey?.trim();
    if (!photoKey) return null;
    if (
      row.guestApprovalStatus === 'pending_face' ||
      row.guestApprovalStatus === 'rejected'
    ) {
      return null;
    }
    return this.r2.createPresignedPortraitGetUrl(photoKey);
  }

  private async toResponse(
    row: ClientInviteRow,
    requestedByMemberName: string | null = null,
  ): Promise<InviteResponse> {
    const validUntil =
      row.validUntil instanceof Date
        ? row.validUntil
        : new Date(String(row.validUntil));
    const hasVehicle = !!row.guestVehiclePlate?.trim();
    const authorizedPhotoUrl = await this.resolveAuthorizedPhotoUrl(row);
    return {
      ...row,
      effectiveStatus: computeEffectiveVisitorInviteStatus({
        status: row.status,
        validUntil,
      }),
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
        ? this.frontendConviteUrl(row.guestLinkCode)
        : null,
      authorizedPhotoUrl,
      requestedByMemberName,
    };
  }

  private async enrichRows(rows: ClientInviteRow[]): Promise<InviteResponse[]> {
    if (rows.length === 0) return [];
    const memberIds = [...new Set(rows.map((r) => r.requestedByMemberId))];
    const memberNames = new Map<string, string>();
    await Promise.all(
      memberIds.map(async (id) => {
        const row = rows.find((r) => r.requestedByMemberId === id);
        if (!row) return;
        const member = await membersQueries.getMemberById(
          this.database.db,
          id,
          row.clientId,
        );
        if (member) memberNames.set(id, member.name);
      }),
    );
    return Promise.all(
      rows.map((row) =>
        this.toResponse(row, memberNames.get(row.requestedByMemberId) ?? null),
      ),
    );
  }

  private async expireStale(clientId: string) {
    await inviteQueries.inviteExpireStaleActives(this.database.db, clientId);
  }

  async listForClient(
    user: JwtPayload,
    clientId: string,
    query: { status?: string },
  ): Promise<InviteResponse[]> {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    await this.expireStale(clientId);
    const rows = await inviteQueries.inviteListByClient(
      this.database.db,
      clientId,
      { status: query.status },
    );
    return this.enrichRows(rows);
  }

  async listForMember(user: JwtPayload): Promise<InviteResponse[]> {
    this.assertMemberJwt(user);
    await this.expireStale(user.clientId);
    const rows = await inviteQueries.inviteListByMember(
      this.database.db,
      user.memberId,
      user.clientId,
    );
    return this.enrichRows(rows);
  }

  async createFromMember(user: JwtPayload, body: unknown) {
    this.assertMemberJwt(user);
    const parsed = createVisitorInviteSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;

    if (d.guestDocument) {
      const existingActive =
        await inviteQueries.inviteFindActiveByGuestDocumentForRequester(
          this.database.db,
          user.clientId,
          user.memberId,
          d.guestDocument,
        );
      if (existingActive) {
        throw new BadRequestException(
          'Já existe um convite ativo para este documento. Edite ou renove o convite existente.',
        );
      }
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

    const row = await inviteQueries.inviteInsert(this.database.db, {
      clientId: user.clientId,
      requestedByMemberId: user.memberId,
      guestName: d.guestName,
      guestDocument: d.guestDocument,
      guestPhone: d.guestPhone,
      guestApprovalStatus: 'pending_face',
      status: 'active',
      validFrom: d.validFrom,
      validUntil: d.validUntil,
      notes: d.notes ?? null,
      usedAt: null,
      ...vehiclePatch,
    });
    if (!row) {
      throw new BadRequestException('Não foi possível registrar o convite.');
    }
    return this.toResponse(row);
  }

  async updateForMember(user: JwtPayload, id: string, body: unknown) {
    this.assertMemberJwt(user);
    const parsed = updateVisitorInviteSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;

    const row = await this.assertOwnedInvite(id, user.clientId, user.memberId);
    const effectiveStatus = computeEffectiveVisitorInviteStatus({
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
        'Somente convites ativos podem ser editados ou renovados.',
      );
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

    const updated = await inviteQueries.inviteUpdate(
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
        ...vehiclePatch,
      },
    );
    if (!updated) {
      throw new NotFoundException('Convite não encontrado.');
    }
    return this.toResponse(updated);
  }

  async deleteForMember(user: JwtPayload, id: string) {
    this.assertMemberJwt(user);
    await this.expireStale(user.clientId);
    const row = await this.assertOwnedInvite(id, user.clientId, user.memberId);
    await this.removeGuestFaceFromReadersBeforeDelete(row, user.clientId, id);
    const deleted = await inviteQueries.inviteDelete(
      this.database.db,
      id,
      user.clientId,
      user.memberId,
    );
    if (!deleted) {
      throw new BadRequestException(
        'Convites ativos não podem ser excluídos. Cancele ou marque como utilizado antes.',
      );
    }
    return { ok: true };
  }

  async deleteForClient(user: JwtPayload, clientId: string, id: string) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    await this.expireStale(clientId);
    const row = await inviteQueries.inviteGetById(
      this.database.db,
      id,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Convite não encontrado.');
    }
    await this.removeGuestFaceFromReadersBeforeDelete(row, clientId, id);
    const deleted = await inviteQueries.inviteDelete(
      this.database.db,
      id,
      clientId,
    );
    if (!deleted) {
      throw new BadRequestException(
        'Convites ativos não podem ser excluídos. Cancele ou marque como utilizado antes.',
      );
    }
    return { ok: true };
  }

  async generateGuestLink(user: JwtPayload, id: string) {
    this.assertMemberJwt(user);
    const row = await this.assertOwnedInvite(id, user.clientId, user.memberId);
    if (row.guestLinkCode) {
      return {
        code: row.guestLinkCode,
        registrationUrl: this.frontendConviteUrl(row.guestLinkCode),
      };
    }

    let code = '';
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = randomLinkCode();
      const taken = await inviteQueries.isGuestLinkCodeTaken(
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

    const updated = await inviteQueries.inviteUpdateGuestLinkCode(
      this.database.db,
      id,
      user.clientId,
      code,
    );
    if (!updated) {
      throw new NotFoundException('Convite não encontrado.');
    }
    return {
      code,
      registrationUrl: this.frontendConviteUrl(code),
    };
  }

  async getGuestFacePreviewUrl(user: JwtPayload, id: string) {
    this.assertMemberJwt(user);
    const row = await this.assertOwnedInvite(id, user.clientId, user.memberId);
    if (!row.guestFaceImageKey) {
      throw new BadRequestException('O visitante ainda não enviou a foto.');
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

  private async performGuestFaceSync(
    row: ClientInviteRow,
    id: string,
    clientId: string,
    faceId: number,
  ) {
    if (!row.guestFaceImageKey) {
      throw new BadRequestException('Foto do visitante não encontrada.');
    }
    const guestName = row.guestName?.trim();
    if (!guestName) {
      throw new BadRequestException('Nome do visitante não informado.');
    }

    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      clientId,
    );
    if (!client) {
      throw new BadRequestException('Cliente não encontrado.');
    }

    const { buffer } = await this.r2.getObjectBytes(row.guestFaceImageKey);

    this.faceSync.enqueuePersonSync({
      clientId,
      entityKind: 'invite_guest',
      entityId: id,
      requestedByMemberId: row.requestedByMemberId,
      faceId,
      name: guestName,
      imageBuffer: buffer,
      photoKey: row.guestFaceImageKey,
      timeSectionIds: [ALWAYS_TIME_ZONE_INDEX],
      logContext: `invite-guest=${id}`,
      validFrom:
        row.validFrom instanceof Date
          ? row.validFrom
          : new Date(String(row.validFrom)),
      validUntil:
        row.validUntil instanceof Date
          ? row.validUntil
          : new Date(String(row.validUntil)),
      persistResult: async (sync) => {
        await inviteQueries.inviteUpdateGuestApproval(
          this.database.db,
          id,
          clientId,
          {
            guestFaceSyncStatus: sync.deviceSyncStatus,
            guestFaceSyncedAt:
              sync.deviceSyncStatus === 'synced' ? new Date() : null,
            guestFaceSyncError: sync.deviceSyncError,
          },
        );
        this.eventEmitter.emit(INVITE_GUEST_FACE_SYNCED, {
          inviteId: id,
          clientId,
          requestedByMemberId: row.requestedByMemberId,
          guestName,
          syncStatus: sync.deviceSyncStatus,
        } satisfies InviteGuestFaceSyncedPayload);
      },
    });

    let lprResult: {
      lprSyncStatus: 'pending_sync' | 'synced' | 'sync_failed';
      lprSyncError: string | null;
    } | null = null;
    if (row.guestVehiclePlate?.trim()) {
      lprResult = await this.lprPlateSync.pushPlateToLprCameras({
        clientId,
        plate: row.guestVehiclePlate,
        ownerDisplayName: guestName,
        vehicleColor: row.guestVehicleColor,
        logContext: `invite-guest=${id}`,
      });
    }

    const updated = await inviteQueries.inviteUpdateGuestApproval(
      this.database.db,
      id,
      clientId,
      {
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
      throw new NotFoundException('Convite não encontrado.');
    }

    return {
      syncStatus: 'pending_sync' as const,
      row: updated,
    };
  }

  private async executeGuestFaceApproval(
    row: ClientInviteRow,
    id: string,
    clientId: string,
  ) {
    const faceId = await registrationsQueries.bumpClientFaceCounter(
      this.database.db,
      clientId,
    );

    const approved = await inviteQueries.inviteUpdateGuestApproval(
      this.database.db,
      id,
      clientId,
      {
        guestApprovalStatus: 'approved',
        guestFaceId: faceId,
        guestFaceSyncStatus: 'pending_sync',
        guestFaceSyncedAt: null,
        guestFaceSyncError: null,
      },
    );
    if (!approved) {
      throw new NotFoundException('Convite não encontrado.');
    }

    const { row: syncedRow } = await this.performGuestFaceSync(
      { ...approved, guestFaceImageKey: row.guestFaceImageKey },
      id,
      clientId,
      faceId,
    );

    return this.toResponse(syncedRow);
  }

  @OnEvent(INVITE_GUEST_FACE_APPROVED, { async: true })
  async handleGuestFaceApproved(
    payload: InviteGuestFaceApprovedPayload,
  ): Promise<void> {
    try {
      const row = await inviteQueries.inviteGetById(
        this.database.db,
        payload.inviteId,
        payload.clientId,
      );
      if (!row || row.guestApprovalStatus !== 'approved') {
        return;
      }
      if (row.guestFaceId == null) {
        return;
      }

      await this.performGuestFaceSync(
        row,
        payload.inviteId,
        payload.clientId,
        row.guestFaceId,
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Sync invite guest face falhou (${payload.inviteId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await inviteQueries.inviteUpdateGuestApproval(
        this.database.db,
        payload.inviteId,
        payload.clientId,
        {
          guestFaceSyncStatus: 'sync_failed',
          guestFaceSyncError:
            err instanceof Error ? err.message : 'Falha na sincronização.',
        },
      );
      const syncedPayload: InviteGuestFaceSyncedPayload = {
        ...payload,
        syncStatus: 'sync_failed',
      };
      this.eventEmitter.emit(INVITE_GUEST_FACE_SYNCED, syncedPayload);
    }
  }

  async submitGuestFaceDirect(user: JwtPayload, id: string, body: unknown) {
    this.assertMemberJwt(user);
    const parsed = z
      .object({ imageBase64: z.string().min(64) })
      .safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const row = await this.assertOwnedInvite(id, user.clientId, user.memberId);
    if (row.guestApprovalStatus === 'approved') {
      throw new ConflictException('Face já aprovada.');
    }
    if (!row.guestName?.trim()) {
      throw new BadRequestException(
        'Informe os dados do visitante antes de enviar a foto.',
      );
    }

    let payload = parsed.data.imageBase64.trim();
    let mime = 'image/jpeg';
    const dataUrlMatch = /^data:([^;,]+);base64,(.+)$/i.exec(payload);
    if (dataUrlMatch) {
      mime = dataUrlMatch[1].trim().toLowerCase();
      payload = dataUrlMatch[2].replace(/\s/g, '');
    } else {
      payload = payload.replace(/\s/g, '');
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(payload, 'base64');
    } catch {
      throw new BadRequestException('Imagem inválida.');
    }

    if (buffer.length < 256 || !(await isPortraitImageUsable(buffer))) {
      throw new BadRequestException('Foto inválida para sincronização.');
    }

    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      user.clientId,
    );
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    const ext = this.r2.extForImageMime(mime);
    const contentType =
      mime.split(';')[0]?.trim().toLowerCase() ?? 'image/jpeg';
    const key = this.r2.buildInviteGuestFaceKey(
      client.companyId,
      user.clientId,
      id,
      ext,
    );
    await this.r2.putObject(key, buffer, contentType);
    void storeReaderFaceVariants(this.r2, key, buffer);

    const submitted = await inviteQueries.inviteUpdateGuestFaceSubmitted(
      this.database.db,
      id,
      key,
    );
    if (!submitted) {
      throw new NotFoundException('Convite não encontrado.');
    }

    return this.executeGuestFaceApproval(submitted, id, user.clientId);
  }

  async approveGuestFace(user: JwtPayload, id: string) {
    this.assertMemberJwt(user);
    const row = await this.assertOwnedInvite(id, user.clientId, user.memberId);
    if (row.guestApprovalStatus !== 'submitted') {
      throw new BadRequestException(
        'Só é possível aprovar após o visitante enviar a foto.',
      );
    }
    if (!row.guestFaceImageKey) {
      throw new BadRequestException('Foto do visitante não encontrada.');
    }

    const faceId = await registrationsQueries.bumpClientFaceCounter(
      this.database.db,
      user.clientId,
    );

    const updated = await inviteQueries.inviteUpdateGuestApproval(
      this.database.db,
      id,
      user.clientId,
      {
        guestApprovalStatus: 'approved',
        guestFaceId: faceId,
        guestFaceSyncStatus: 'pending_sync',
        guestFaceSyncedAt: null,
        guestFaceSyncError: null,
      },
    );
    if (!updated) {
      throw new NotFoundException('Convite não encontrado.');
    }

    const response = await this.toResponse(updated);

    this.eventEmitter.emit(INVITE_GUEST_FACE_APPROVED, {
      inviteId: id,
      clientId: user.clientId,
      requestedByMemberId: user.memberId,
      guestName: row.guestName?.trim() ?? '',
    } satisfies InviteGuestFaceApprovedPayload);

    return response;
  }

  async rejectGuestFace(user: JwtPayload, id: string) {
    this.assertMemberJwt(user);
    const row = await this.assertOwnedInvite(id, user.clientId, user.memberId);
    if (row.guestApprovalStatus !== 'submitted') {
      throw new BadRequestException(
        'Só é possível recusar após o visitante enviar a foto.',
      );
    }
    const updated = await inviteQueries.inviteUpdateGuestApproval(
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
      throw new NotFoundException('Convite não encontrado.');
    }
    return this.toResponse(updated);
  }

  async markUsedForClient(
    user: JwtPayload,
    clientId: string,
    id: string,
  ): Promise<InviteResponse> {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    await this.expireStale(clientId);
    const row = await inviteQueries.inviteGetById(
      this.database.db,
      id,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Convite não encontrado.');
    }
    const status = computeEffectiveVisitorInviteStatus({
      status: row.status,
      validUntil:
        row.validUntil instanceof Date
          ? row.validUntil
          : new Date(String(row.validUntil)),
    });
    if (status !== 'active') {
      throw new BadRequestException(
        'Só é possível marcar como utilizado quando o convite está ativo e dentro da validade.',
      );
    }
    const updated = await inviteQueries.inviteUpdateStatus(
      this.database.db,
      id,
      clientId,
      'used',
      { usedAt: new Date() },
    );
    if (!updated) {
      throw new NotFoundException('Convite não encontrado.');
    }
    return this.toResponse(updated);
  }

  async cancelForClient(
    user: JwtPayload,
    clientId: string,
    id: string,
  ): Promise<InviteResponse> {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    await this.expireStale(clientId);
    return this.cancelActive(id, clientId, null);
  }

  async cancelForMember(user: JwtPayload, id: string) {
    this.assertMemberJwt(user);
    await this.expireStale(user.clientId);
    return this.cancelActive(id, user.clientId, user.memberId);
  }

  private async cancelActive(
    id: string,
    clientId: string,
    onlyRequestedByMemberId: string | null,
  ): Promise<InviteResponse> {
    const row = await inviteQueries.inviteGetById(
      this.database.db,
      id,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Convite não encontrado.');
    }
    if (
      onlyRequestedByMemberId &&
      row.requestedByMemberId !== onlyRequestedByMemberId
    ) {
      throw new ForbiddenException('Este convite não foi criado por você.');
    }
    const status = computeEffectiveVisitorInviteStatus({
      status: row.status,
      validUntil:
        row.validUntil instanceof Date
          ? row.validUntil
          : new Date(String(row.validUntil)),
    });
    if (status !== 'active') {
      throw new BadRequestException(
        'Somente convites ativos podem ser cancelados.',
      );
    }

    const guestFaceIdToRemove =
      row.guestFaceId != null && row.guestFaceSyncStatus === 'synced'
        ? row.guestFaceId
        : null;

    if (guestFaceIdToRemove != null) {
      await this.faceSync.removePersonFromReaders({
        clientId,
        faceId: guestFaceIdToRemove,
        logContext: `cancel-invite=${id}`,
        requireAll: true,
      });
    }

    const updated = await inviteQueries.inviteUpdateStatus(
      this.database.db,
      id,
      clientId,
      'cancelled',
      guestFaceIdToRemove != null ? { guestFaceId: null } : {},
    );
    if (!updated) {
      throw new NotFoundException('Convite não encontrado.');
    }
    return this.toResponse(updated);
  }

  private async removeGuestFaceFromReadersBeforeDelete(
    row: ClientInviteRow,
    clientId: string,
    id: string,
  ) {
    if (row.guestFaceId == null) return;
    await this.faceSync.removePersonFromReaders({
      clientId,
      faceId: row.guestFaceId,
      logContext: `delete-invite=${id}`,
      requireAll: true,
    });
  }

  private async assertOwnedInvite(
    id: string,
    clientId: string,
    memberId: string,
  ): Promise<ClientInviteRow> {
    const row = await inviteQueries.inviteGetById(
      this.database.db,
      id,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Convite não encontrado.');
    }
    if (row.requestedByMemberId !== memberId) {
      throw new ForbiddenException('Este convite não foi criado por você.');
    }
    return row;
  }

  async getInviteByGuestLinkCode(code: string) {
    const row = await inviteQueries.inviteGetByGuestLinkCode(
      this.database.db,
      code.trim(),
    );
    if (!row) return null;
    const status = computeEffectiveVisitorInviteStatus({
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
    inviteId: string,
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
    return this.r2.buildInviteGuestFaceKey(
      client.companyId,
      clientId,
      inviteId,
      ext,
    );
  }
}
