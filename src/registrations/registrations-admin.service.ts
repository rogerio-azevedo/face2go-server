import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import * as clientsQueries from '../database/queries/clients.queries';
import * as membersQueries from '../database/queries/members.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import { DatabaseService } from '../database/database.service';
import { PermissionsService } from '../permissions/permissions.service';
import { MembersService } from '../members/members.service';
import { PersonProfileService } from '../people/person-profile.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { zodFirstMessage } from '../validation/zod-utils';
import type { ListRegistrationsQuery } from '../validation/registrations.schema';
import {
  blockRegistrationSchema,
  updateRegistrationSchema,
} from '../validation/registrations.schema';
import { isMinor, toIsoDateString } from '../common/utils/birth-date';
import {
  normalizeRegistrationFields,
  mergeHiddenRegistrationFields,
} from './registration-additional-data';
import { assertDocumentAvailableInClient } from './registration-document-unique';
import { resolveFieldsConsideringRestrictMinors } from './registration-fields-resolve';
import {
  buildPaginatedResult,
  parseListPaginationParams,
} from '../common/pagination';

const rejectBodySchema = z.object({
  notes: z.string().max(2000).optional().nullable(),
});

@Injectable()
export class RegistrationsAdminService {
  private readonly logger = new Logger(RegistrationsAdminService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly r2: R2StorageService,
    private readonly faceSync: FaceSyncService,
    private readonly membersService: MembersService,
    private readonly personProfile: PersonProfileService,
  ) {}

  private ensureCompany(user: JwtPayload): string {
    const companyId = user.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Sem permissão.');
    }
    return companyId;
  }

  private async ensureCompanyCanAccessClient(
    user: JwtPayload,
    clientId: string,
  ) {
    const companyId = this.ensureCompany(user);
    if (user.role === 'company_admin') {
      const client = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!client) throw new NotFoundException('Cliente não encontrado.');
      return client;
    }
    if (user.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        user.role,
        user.companyUserId,
        'clients',
        'can_read',
      );
      if (!ok) {
        throw new ForbiddenException('Sem permissão.');
      }
      const client = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!client) throw new NotFoundException('Cliente não encontrado.');
      return client;
    }
    throw new ForbiddenException('Sem permissão.');
  }

  private ensureClientTenant(user: JwtPayload): string {
    const clientId = user.clientId ?? undefined;
    if (
      !clientId ||
      (user.role !== 'client_admin' && user.role !== 'client_operator')
    ) {
      throw new ForbiddenException('Sem permissão.');
    }
    return clientId;
  }

  private async optionalFaceUrl(
    faceImageKey: string | null,
  ): Promise<string | null> {
    if (!faceImageKey) return null;
    try {
      return await this.r2.createPresignedPortraitGetUrl(faceImageKey);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `URL assinada (cadastro/R2): falha para key="${faceImageKey}": ${msg}`,
      );
      return null;
    }
  }

  private async mapRow(
    row: registrationsQueries.RegistrationRow,
    progress: { total: number; syncedByFace: Map<number, number> },
  ) {
    const faceUrl = await this.optionalFaceUrl(row.faceImageKey);
    const birthDate = toIsoDateString(row.birthDate);
    const hasFacialReaders = progress.total > 0;
    const readerSyncSynced =
      row.faceId != null
        ? (progress.syncedByFace.get(row.faceId) ?? 0)
        : null;
    return {
      id: row.id,
      clientId: row.clientId,
      registrationLinkId: row.registrationLinkId,
      name: row.name,
      document: row.document,
      phone: row.phone,
      email: row.email,
      birthDate,
      isMinor: birthDate ? isMinor(birthDate) : null,
      additionalData: row.additionalData,
      status: row.status,
      isActive: row.isActive,
      submittedAt: row.submittedAt,
      truthDeclaredAt: row.truthDeclaredAt
        ? row.truthDeclaredAt.toISOString()
        : null,
      approvedAt: row.approvedAt,
      rejectionNotes: row.rejectionNotes,
      blockReason: row.blockReason ?? null,
      blockedAt: row.blockedAt ? row.blockedAt.toISOString() : null,
      blockedByUserId: row.blockedByUserId ?? null,
      createdAt: row.createdAt,
      hasFacePhoto: Boolean(row.faceImageKey),
      faceUrl,
      faceId: row.faceId ?? null,
      deviceSyncStatus: row.deviceSyncStatus ?? null,
      deviceSyncedAt: row.deviceSyncedAt
        ? row.deviceSyncedAt.toISOString()
        : null,
      deviceSyncError: row.deviceSyncError ?? null,
      hasFacialReaders,
      readerSyncSynced,
      readerSyncTotal: hasFacialReaders ? progress.total : null,
    };
  }

  private async mapRowForClient(
    row: registrationsQueries.RegistrationRow,
    clientId: string,
  ) {
    const progress = await this.faceSync.getReaderSyncCounts(
      clientId,
      row.faceId != null ? [row.faceId] : [],
    );
    return this.mapRow(row, progress);
  }

  async listForCompanyUser(
    user: JwtPayload,
    clientId: string,
    query: ListRegistrationsQuery,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.listShared(clientId, query);
  }

  async listForClientTenant(user: JwtPayload, query: ListRegistrationsQuery) {
    const clientId = this.ensureClientTenant(user);
    return this.listShared(clientId, query);
  }

  private async listShared(clientId: string, query: ListRegistrationsQuery) {
    const { page, pageSize, search, offset } = parseListPaginationParams(
      query.page,
      query.pageSize,
      query.search,
    );
    const listOpts = {
      status: query.status,
      search,
      block: query.block,
      unit: query.unit,
      room: query.room,
      offset,
      limit: pageSize,
    };

    const [rows, total, counts, client] = await Promise.all([
      registrationsQueries.listSubmittedRegistrationsForClient(
        this.database.db,
        clientId,
        listOpts,
      ),
      registrationsQueries.countSubmittedRegistrationsForClient(
        this.database.db,
        clientId,
        {
          status: query.status,
          search,
          block: query.block,
          unit: query.unit,
          room: query.room,
        },
      ),
      registrationsQueries.countSubmittedRegistrationsByStatus(
        this.database.db,
        clientId,
      ),
      clientsQueries.getClientByIdOnly(this.database.db, clientId),
    ]);
    const faceIds = [
      ...new Set(rows.flatMap((r) => (r.faceId == null ? [] : [r.faceId]))),
    ];
    const progress = await this.faceSync.getReaderSyncCounts(clientId, faceIds);

    const data = await Promise.all(rows.map((r) => this.mapRow(r, progress)));
    return {
      ...buildPaginatedResult(data, total, page, pageSize),
      counts,
      clientType: client?.type ?? null,
    };
  }

  async faceUrlForCompanyUser(
    user: JwtPayload,
    clientId: string,
    registrationId: string,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.faceUrlShared(clientId, registrationId);
  }

  async faceUrlForClientTenant(user: JwtPayload, registrationId: string) {
    const clientId = this.ensureClientTenant(user);
    return this.faceUrlShared(clientId, registrationId);
  }

  private async faceUrlShared(clientId: string, registrationId: string) {
    const row = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    if (!row?.faceImageKey) {
      throw new NotFoundException('Cadastro ou foto não encontrada.');
    }
    const url = await this.r2.createPresignedGetUrl(row.faceImageKey);
    return { url, expiresInSeconds: 60 * 60 };
  }

  async approveForCompanyUser(
    user: JwtPayload,
    clientId: string,
    registrationId: string,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.approveShared(clientId, registrationId, user.sub);
  }

  async approveForClientTenant(user: JwtPayload, registrationId: string) {
    const clientId = this.ensureClientTenant(user);
    return this.approveShared(clientId, registrationId, user.sub);
  }

  private async approveShared(
    clientId: string,
    registrationId: string,
    decidedByUserId: string,
  ) {
    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      clientId,
    );
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    const existing = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    if (client.type !== 'school' && existing) {
      await assertDocumentAvailableInClient(
        this.database.db,
        clientId,
        existing.document,
        { excludeRegistrationId: registrationId, checkPending: false },
      );
    }

    const updated = await registrationsQueries.approveRegistration(
      this.database.db,
      registrationId,
      clientId,
      decidedByUserId,
    );
    if (!updated) {
      throw new NotFoundException(
        'Cadastro não encontrado ou já foi processado.',
      );
    }

    let rowOut = updated;
    if (updated.faceImageKey) {
      const faceId = await registrationsQueries.bumpClientFaceCounter(
        this.database.db,
        clientId,
      );
      const linked = await registrationsQueries.setRegistrationFaceAfterApprove(
        this.database.db,
        registrationId,
        clientId,
        faceId,
      );
      if (!linked) {
        throw new BadRequestException('Falha ao atribuir face_id ao cadastro.');
      }
      rowOut = linked;

      try {
        await this.faceSync.enqueueApprovedRegistrationJob(
          registrationId,
          clientId,
          decidedByUserId,
        );
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Erro ao enfileirar sync da face com os leitores.';
        this.logger.warn(`enqueue pós-aprovação reg=${registrationId}: ${msg}`);
      }
    }

    if (client.type !== 'school') {
      try {
        await this.membersService.upsertFromApprovedRegistration(
          rowOut,
          client.type,
        );
      } catch (err: unknown) {
        this.logger.warn(
          `Falha ao criar membro pós-aprovação reg=${registrationId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return await this.mapRowForClient(rowOut, clientId);
  }

  async rejectForCompanyUser(
    user: JwtPayload,
    clientId: string,
    registrationId: string,
    body: unknown,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.rejectShared(clientId, registrationId, user.sub, body);
  }

  async rejectForClientTenant(
    user: JwtPayload,
    registrationId: string,
    body: unknown,
  ) {
    const clientId = this.ensureClientTenant(user);
    return this.rejectShared(clientId, registrationId, user.sub, body);
  }

  private async rejectShared(
    clientId: string,
    registrationId: string,
    decidedByUserId: string,
    body: unknown,
  ) {
    const parsed = rejectBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const updated = await registrationsQueries.rejectRegistration(
      this.database.db,
      registrationId,
      clientId,
      decidedByUserId,
      parsed.data.notes?.trim() ?? null,
    );
    if (!updated) {
      throw new NotFoundException(
        'Cadastro não encontrado ou já foi processado.',
      );
    }
    return await this.mapRowForClient(updated, clientId);
  }

  async blockForCompanyUser(
    user: JwtPayload,
    clientId: string,
    registrationId: string,
    body: unknown,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.blockShared(clientId, registrationId, user.sub, body);
  }

  async blockForClientTenant(
    user: JwtPayload,
    registrationId: string,
    body: unknown,
  ) {
    const clientId = this.ensureClientTenant(user);
    return this.blockShared(clientId, registrationId, user.sub, body);
  }

  private async blockShared(
    clientId: string,
    registrationId: string,
    decidedByUserId: string,
    body: unknown,
  ) {
    const parsed = blockRegistrationSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const reason = parsed.data.reason;

    const existing = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    if (!existing || !existing.isActive || !existing.submittedAt) {
      throw new NotFoundException(
        'Cadastro não encontrado ou já foi processado.',
      );
    }
    if (existing.status === 'blocked') {
      throw new BadRequestException('Cadastro já está bloqueado.');
    }
    if (existing.status !== 'draft' && existing.status !== 'approved') {
      throw new BadRequestException(
        'Só é possível bloquear cadastros aguardando ou aprovados.',
      );
    }
    if (!existing.faceImageKey) {
      throw new BadRequestException(
        'Cadastro sem foto — não é possível enviar a face ao leitor.',
      );
    }

    const updated = await registrationsQueries.blockRegistration(
      this.database.db,
      registrationId,
      clientId,
      decidedByUserId,
      reason,
    );
    if (!updated) {
      throw new NotFoundException(
        'Cadastro não encontrado ou já foi processado.',
      );
    }

    let rowOut = updated;
    if (rowOut.faceId == null) {
      const faceId = await registrationsQueries.bumpClientFaceCounter(
        this.database.db,
        clientId,
      );
      const linked = await registrationsQueries.setRegistrationFaceAfterApprove(
        this.database.db,
        registrationId,
        clientId,
        faceId,
      );
      if (!linked) {
        throw new BadRequestException('Falha ao atribuir face_id ao cadastro.');
      }
      rowOut = linked;
    }

    try {
      await membersQueries.setMemberBlockByRegistrationId(
        this.database.db,
        clientId,
        registrationId,
        {
          blockReason: reason,
          blockedAt: rowOut.blockedAt ?? new Date(),
          blockedByUserId: decidedByUserId,
        },
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Falha ao marcar membro bloqueado reg=${registrationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    try {
      await this.faceSync.enqueueApprovedRegistrationJob(
        registrationId,
        clientId,
        decidedByUserId,
        { resetReaderProgress: true, blocked: true },
      );
    } catch (err: unknown) {
      this.logger.warn(
        `enqueue pós-bloqueio reg=${registrationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const refreshed = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    return await this.mapRowForClient(refreshed ?? rowOut, clientId);
  }

  async unblockForCompanyUser(
    user: JwtPayload,
    clientId: string,
    registrationId: string,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.unblockShared(clientId, registrationId, user.sub);
  }

  async unblockForClientTenant(user: JwtPayload, registrationId: string) {
    const clientId = this.ensureClientTenant(user);
    return this.unblockShared(clientId, registrationId, user.sub);
  }

  private async unblockShared(
    clientId: string,
    registrationId: string,
    decidedByUserId: string,
  ) {
    const existing = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    if (!existing || !existing.isActive || !existing.submittedAt) {
      throw new NotFoundException(
        'Cadastro não encontrado ou já foi processado.',
      );
    }
    if (existing.status !== 'blocked') {
      throw new BadRequestException('Cadastro não está bloqueado.');
    }

    const updated = await registrationsQueries.unblockRegistration(
      this.database.db,
      registrationId,
      clientId,
    );
    if (!updated) {
      throw new NotFoundException(
        'Cadastro não encontrado ou já foi processado.',
      );
    }

    try {
      await membersQueries.setMemberBlockByRegistrationId(
        this.database.db,
        clientId,
        registrationId,
        {
          blockReason: null,
          blockedAt: null,
          blockedByUserId: null,
        },
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Falha ao desmarcar membro bloqueado reg=${registrationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (updated.faceImageKey && updated.faceId != null) {
      try {
        await this.faceSync.enqueueApprovedRegistrationJob(
          registrationId,
          clientId,
          decidedByUserId,
          { resetReaderProgress: true, blocked: false },
        );
      } catch (err: unknown) {
        this.logger.warn(
          `enqueue pós-desbloqueio reg=${registrationId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const refreshed = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    return await this.mapRowForClient(refreshed ?? updated, clientId);
  }

  private ensureCompanyAdmin(user: JwtPayload) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
  }

  private ensureClientAdmin(user: JwtPayload) {
    if (user.role !== 'client_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
  }

  async updateForCompanyUser(
    user: JwtPayload,
    clientId: string,
    registrationId: string,
    body: unknown,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.updateShared(clientId, registrationId, body);
  }

  async updateForClientTenant(
    user: JwtPayload,
    registrationId: string,
    body: unknown,
  ) {
    const clientId = this.ensureClientTenant(user);
    return this.updateShared(clientId, registrationId, body);
  }

  private async updateShared(
    clientId: string,
    registrationId: string,
    body: unknown,
  ) {
    const parsed = updateRegistrationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const row = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Cadastro não encontrado.');
    }
    if (!row.isActive) {
      throw new BadRequestException(
        'Cadastro excluído. Restaure antes de editar.',
      );
    }
    if (row.status !== 'approved') {
      throw new BadRequestException(
        'Só é possível editar cadastros aprovados.',
      );
    }

    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      clientId,
    );
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    const fieldsConfig = (
      await resolveFieldsConsideringRestrictMinors(
        this.database.db,
        clientId,
        client.type,
        client.registrationConfig,
      )
    ).fields;
    const normalized = normalizeRegistrationFields(fieldsConfig, {
      document: parsed.data.document,
      phone: parsed.data.phone,
      email: parsed.data.email,
      birthDate: parsed.data.birthDate,
      additionalData: parsed.data.additionalData,
    });
    const merged = mergeHiddenRegistrationFields(fieldsConfig, normalized, {
      document: row.document,
      phone: row.phone,
      email: row.email,
      birthDate: toIsoDateString(row.birthDate),
      additionalData: row.additionalData,
    });

    const linkedMember = await membersQueries.getMemberByRegistrationId(
      this.database.db,
      registrationId,
    );
    await assertDocumentAvailableInClient(
      this.database.db,
      clientId,
      merged.document,
      {
        excludeRegistrationId: registrationId,
        excludeMemberId: linkedMember?.id,
      },
    );

    const updated = await registrationsQueries.updateRegistrationProfile(
      this.database.db,
      registrationId,
      clientId,
      {
        name: parsed.data.name,
        document: merged.document,
        phone: merged.phone,
        email: merged.email,
        birthDate: merged.birthDate,
        additionalData: merged.additionalData,
      },
    );
    if (!updated) {
      throw new NotFoundException('Cadastro não encontrado.');
    }

    try {
      await this.membersService.syncProfileFromRegistration(updated);
    } catch (err: unknown) {
      this.logger.warn(
        `Falha ao sincronizar membro após edição reg=${registrationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return this.mapRowForClient(updated, clientId);
  }

  async softDeleteForCompanyUser(
    user: JwtPayload,
    clientId: string,
    registrationId: string,
  ) {
    this.ensureCompanyAdmin(user);
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.softDeleteShared(clientId, registrationId);
  }

  async softDeleteForClientTenant(user: JwtPayload, registrationId: string) {
    this.ensureClientAdmin(user);
    const clientId = this.ensureClientTenant(user);
    return this.softDeleteShared(clientId, registrationId);
  }

  private async softDeleteShared(clientId: string, registrationId: string) {
    const row = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Cadastro não encontrado.');
    }
    if (!row.isActive) {
      throw new BadRequestException('Cadastro já está excluído.');
    }
    if (row.status !== 'approved') {
      throw new BadRequestException(
        'Só é possível excluir cadastros aprovados.',
      );
    }

    const member = await this.membersService.getByRegistrationId(
      clientId,
      registrationId,
    );

    if (row.faceId != null) {
      const removeFromReader =
        await this.personProfile.shouldRemoveFaceFromReader(
          row.faceId,
          clientId,
          { memberId: member?.id },
        );
      if (removeFromReader) {
        await this.faceSync.removePersonFromReaders({
          clientId,
          faceId: row.faceId,
          logContext: `delete-registration=${registrationId}`,
          requireAll: true,
        });
      }
    }

    await this.membersService.setActiveByRegistrationId(
      clientId,
      registrationId,
      false,
    );

    const updated = await registrationsQueries.setRegistrationActive(
      this.database.db,
      registrationId,
      clientId,
      false,
    );
    if (!updated) {
      throw new NotFoundException('Cadastro não encontrado.');
    }

    return this.mapRowForClient(updated, clientId);
  }

  async restoreForCompanyUser(
    user: JwtPayload,
    clientId: string,
    registrationId: string,
  ) {
    this.ensureCompanyAdmin(user);
    await this.ensureCompanyCanAccessClient(user, clientId);
    return this.restoreShared(clientId, registrationId, user.sub);
  }

  async restoreForClientTenant(user: JwtPayload, registrationId: string) {
    this.ensureClientAdmin(user);
    const clientId = this.ensureClientTenant(user);
    return this.restoreShared(clientId, registrationId, user.sub);
  }

  private async restoreShared(
    clientId: string,
    registrationId: string,
    decidedByUserId: string,
  ) {
    const row = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Cadastro não encontrado.');
    }
    if (row.isActive) {
      throw new BadRequestException('Cadastro não está excluído.');
    }

    const updated = await registrationsQueries.setRegistrationActive(
      this.database.db,
      registrationId,
      clientId,
      true,
    );
    if (!updated) {
      throw new NotFoundException('Cadastro não encontrado.');
    }

    try {
      await this.membersService.setActiveByRegistrationId(
        clientId,
        registrationId,
        true,
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Falha ao reativar membro reg=${registrationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (updated.faceImageKey && updated.faceId != null) {
      try {
        await this.faceSync.enqueueApprovedRegistrationJob(
          registrationId,
          clientId,
          decidedByUserId,
          { resetReaderProgress: true },
        );
      } catch (err: unknown) {
        this.logger.warn(
          `enqueue pós-restauração reg=${registrationId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const restored = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      clientId,
    );
    return this.mapRowForClient(restored ?? updated, clientId);
  }
}
