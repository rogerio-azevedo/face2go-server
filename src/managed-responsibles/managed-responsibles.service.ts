import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { randomLinkCode } from '../common/utils/link-code';
import * as clientsQueries from '../database/queries/clients.queries';
import * as invitationQueries from '../database/queries/responsible-invitations.queries';
import type { ResponsibleInvitationRow } from '../database/queries/responsible-invitations.queries';
import * as pickupQueries from '../database/queries/pickup-authorizations.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import * as vehicleQueries from '../database/queries/vehicles.queries';
import { DatabaseService } from '../database/database.service';
import { users } from '../database/schema';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { AccessTimeZoneService } from '../face-sync/access-time-zone.service';
import { LprPlateSyncService } from '../lpr-plate-sync/lpr-plate-sync.service';
import {
  RESPONSIBLE_INVITATION_SUBMITTED,
  type ResponsibleInvitationSubmittedPayload,
} from '../notifications/notifications.events';
import { isPortraitImageUsable } from '../storage/portrait-image.utils';
import { R2StorageService } from '../storage/r2-storage.service';
import {
  createManagedResponsibleSchema,
  createResponsibleInvitationSchema,
} from '../validation/managed-responsibles.schema';
import { zodFirstMessage } from '../validation/zod-utils';

export type InvitationStudentDto = {
  studentId: string;
  name: string;
  relationshipType: string;
  isAuthorizedPickup: boolean;
};

export type ResponsibleInvitationResponse = ResponsibleInvitationRow & {
  students: InvitationStudentDto[];
  registrationUrl: string | null;
  inviterName: string | null;
  hasVehicle: boolean;
};

@Injectable()
export class ManagedResponsiblesService {
  private readonly log = new Logger(ManagedResponsiblesService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly configService: ConfigService,
    private readonly r2: R2StorageService,
    private readonly faceSync: FaceSyncService,
    private readonly accessTimeZone: AccessTimeZoneService,
    private readonly lprPlateSync: LprPlateSyncService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private assertResponsibleJwt(user: JwtPayload): asserts user is JwtPayload & {
    clientId: string;
    responsibleId: string;
  } {
    if (user.role !== 'responsible' || !user.clientId || !user.responsibleId) {
      throw new ForbiddenException('Acesso apenas para conta de responsável.');
    }
  }

  private frontendRegisterUrl(code: string): string {
    const base = this.configService.get<string>('FRONTEND_URL') ?? '';
    const trimmed = base.replace(/\/$/, '');
    return `${trimmed}/cadastro-responsavel/${code}`;
  }

  private async assertOwnedStudents(
    responsibleId: string,
    studentIds: string[],
  ) {
    const allowed = await studentsQueries.listStudentIdsForResponsible(
      this.database.db,
      responsibleId,
    );
    for (const id of studentIds) {
      if (!allowed.includes(id)) {
        throw new BadRequestException(
          'Um ou mais alunos não pertencem à sua conta.',
        );
      }
    }
  }

  private async generateUniqueLinkCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = randomLinkCode();
      const [pickupTaken, invitationTaken] = await Promise.all([
        pickupQueries.isGuestLinkCodeTaken(this.database.db, candidate),
        invitationQueries.invitationIsLinkCodeTaken(
          this.database.db,
          candidate,
        ),
      ]);
      if (!pickupTaken && !invitationTaken) {
        return candidate;
      }
    }
    throw new BadRequestException('Não foi possível gerar o código do link.');
  }

  private async enrichInvitations(
    rows: ResponsibleInvitationRow[],
  ): Promise<ResponsibleInvitationResponse[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const links =
      await invitationQueries.invitationListStudentsForInvitationIds(
        this.database.db,
        ids,
      );
    const byInvitation = new Map<string, InvitationStudentDto[]>();
    for (const link of links) {
      const list = byInvitation.get(link.invitationId) ?? [];
      list.push({
        studentId: link.studentId,
        name: link.studentName,
        relationshipType: link.relationshipType,
        isAuthorizedPickup: link.isAuthorizedPickup,
      });
      byInvitation.set(link.invitationId, list);
    }

    return rows.map((row) => ({
      ...row,
      students: byInvitation.get(row.id) ?? [],
      registrationUrl: row.guestLinkCode
        ? this.frontendRegisterUrl(row.guestLinkCode)
        : null,
      inviterName: null,
      hasVehicle: !!row.vehiclePlate?.trim(),
    }));
  }

  private toInvitationResponse(
    row: ResponsibleInvitationRow,
    students: InvitationStudentDto[],
  ): ResponsibleInvitationResponse {
    return {
      ...row,
      students,
      registrationUrl: row.guestLinkCode
        ? this.frontendRegisterUrl(row.guestLinkCode)
        : null,
      inviterName: null,
      hasVehicle: !!row.vehiclePlate?.trim(),
    };
  }

  private async assertOwnedInvitation(
    id: string,
    clientId: string,
    inviterResponsibleId: string,
  ) {
    const row = await invitationQueries.invitationGetById(
      this.database.db,
      id,
      clientId,
    );
    if (!row || row.inviterResponsibleId !== inviterResponsibleId) {
      throw new NotFoundException('Convite não encontrado.');
    }
    return row;
  }

  private plateRequired(row: ResponsibleInvitationRow): boolean {
    return !!row.vehiclePlate?.trim();
  }

  private canFinalize(row: ResponsibleInvitationRow): boolean {
    if (row.faceApprovalStatus !== 'approved') return false;
    if (this.plateRequired(row) && row.plateApprovalStatus !== 'approved') {
      return false;
    }
    return true;
  }

  private async syncResponsibleFace(params: {
    clientId: string;
    responsibleId: string;
    name: string;
    imageBuffer: Buffer;
    logContext: string;
  }) {
    const faceId = await registrationsQueries.bumpClientFaceCounter(
      this.database.db,
      params.clientId,
    );
    const photoKey = `responsibles/${params.clientId}/${params.responsibleId}/face.jpg`;
    await this.r2.putObject(photoKey, params.imageBuffer, 'image/jpeg');

    await responsiblesQueries.updateResponsibleFace(
      this.database.db,
      params.responsibleId,
      params.clientId,
      {
        photoKey,
        faceId,
        deviceSyncStatus: 'pending_sync',
        deviceSyncedAt: null,
        deviceSyncError: null,
      },
    );

    const faceSync = await this.faceSync.syncPersonOnReaders({
      clientId: params.clientId,
      faceId,
      name: params.name,
      imageBuffer: params.imageBuffer,
      timeSectionIds: await this.accessTimeZone.resolveResponsibleTimeSections(
        params.clientId,
        params.responsibleId,
      ),
      logContext: params.logContext,
    });

    await responsiblesQueries.updateResponsibleFace(
      this.database.db,
      params.responsibleId,
      params.clientId,
      {
        deviceSyncStatus: faceSync.deviceSyncStatus,
        deviceSyncedAt:
          faceSync.deviceSyncStatus === 'synced' ? new Date() : null,
        deviceSyncError: faceSync.deviceSyncError,
      },
    );

    return faceSync;
  }

  private async copyFaceFromExistingResponsibleIfAvailable(params: {
    userId: string;
    clientId: string;
    responsibleId: string;
    name: string;
    logContext: string;
  }): Promise<boolean> {
    const source = await responsiblesQueries.findResponsibleWithPhotoByUserId(
      this.database.db,
      params.userId,
      params.clientId,
    );
    if (!source?.photoKey) return false;

    const { buffer } = await this.r2.getObjectBytes(source.photoKey);
    if (!(await isPortraitImageUsable(buffer))) return false;

    await this.syncResponsibleFace({
      clientId: params.clientId,
      responsibleId: params.responsibleId,
      name: params.name,
      imageBuffer: buffer,
      logContext: `${params.logContext}-face-copy`,
    });
    return true;
  }

  private async createResponsibleFromInvitation(
    row: ResponsibleInvitationRow,
  ): Promise<string> {
    if (
      !row.submittedEmail ||
      !row.submittedPasswordHash ||
      !row.submittedName
    ) {
      throw new BadRequestException('Dados do convidado incompletos.');
    }
    if (!row.faceImageKey) {
      throw new BadRequestException('Foto do convidado não encontrada.');
    }

    const existingUser = await this.database.db.query.users.findFirst({
      where: eq(users.email, row.submittedEmail),
    });
    if (
      existingUser &&
      (await responsiblesQueries.getResponsibleByUserIdAndClient(
        this.database.db,
        existingUser.id,
        row.clientId,
      ))
    ) {
      throw new ConflictException(
        'Este usuário já está vinculado a esta escola.',
      );
    }

    const studentLinks =
      await invitationQueries.invitationListStudentsForInvitation(
        this.database.db,
        row.id,
      );

    const userId = existingUser?.id ?? crypto.randomUUID();
    const responsible = await this.database.db.transaction(async (tx) => {
      if (!existingUser) {
        await tx.insert(users).values({
          id: userId,
          email: row.submittedEmail!,
          password: row.submittedPasswordHash!,
          name: row.submittedName!,
          role: 'member',
          isActive: true,
        });
      }

      const created = await responsiblesQueries.insertResponsible(tx, {
        clientId: row.clientId,
        userId,
        name: row.submittedName!,
        phone: row.submittedPhone ?? null,
        document: row.submittedDocument ?? null,
        isActive: true,
      });

      if (!created) {
        throw new BadRequestException('Não foi possível criar o responsável.');
      }

      for (const link of studentLinks) {
        await responsiblesQueries.insertResponsibleStudentLink(tx, {
          responsibleId: created.id,
          studentId: link.studentId,
          relationshipType: link.relationshipType as never,
          isAuthorizedPickup: link.isAuthorizedPickup,
        });
      }

      return created;
    });

    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      row.clientId,
    );
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    const { buffer } = await this.r2.getObjectBytes(row.faceImageKey);
    if (!(await isPortraitImageUsable(buffer))) {
      throw new BadRequestException('Foto inválida para sincronização.');
    }

    const faceSync = await this.syncResponsibleFace({
      clientId: row.clientId,
      responsibleId: responsible.id,
      name: row.submittedName,
      imageBuffer: buffer,
      logContext: `responsible-invitation=${row.id}`,
    });

    let plateLprResult: {
      lprSyncStatus: 'pending_sync' | 'synced' | 'sync_failed';
      lprSyncError: string | null;
    } | null = null;

    if (row.vehiclePlate?.trim()) {
      try {
        const vehicle = await vehicleQueries.vehicleInsert(this.database.db, {
          clientId: row.clientId,
          responsibleId: responsible.id,
          plate: row.vehiclePlate,
          brand: row.vehicleBrand ?? '',
          model: row.vehicleModel ?? '',
          color: row.vehicleColor ?? '',
        });
        if (vehicle) {
          plateLprResult = await this.lprPlateSync.syncVehiclePlateOnCameras({
            clientId: row.clientId,
            vehicleId: vehicle.id,
            plate: row.vehiclePlate,
            ownerDisplayName: row.submittedName,
            vehicleColor: row.vehicleColor,
            logContext: `responsible-invitation=${row.id}`,
          });
        }
      } catch {
        plateLprResult = {
          lprSyncStatus: 'sync_failed',
          lprSyncError: 'Não foi possível cadastrar o veículo.',
        };
      }
    }

    await invitationQueries.invitationUpdate(
      this.database.db,
      row.id,
      row.clientId,
      {
        status: 'approved',
        createdResponsibleId: responsible.id,
        faceSyncStatus: faceSync.deviceSyncStatus,
        faceSyncedAt:
          faceSync.deviceSyncStatus === 'synced' ? new Date() : null,
        faceSyncError: faceSync.deviceSyncError,
        ...(plateLprResult
          ? {
              plateLprSyncStatus: plateLprResult.lprSyncStatus,
              plateLprSyncedAt:
                plateLprResult.lprSyncStatus === 'synced' ? new Date() : null,
              plateLprSyncError: plateLprResult.lprSyncError,
            }
          : {}),
      },
    );

    return responsible.id;
  }

  async createManagedResponsible(user: JwtPayload, body: unknown) {
    this.assertResponsibleJwt(user);
    const parsed = createManagedResponsibleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    const studentIds = d.students.map((s) => s.studentId);
    await this.assertOwnedStudents(user.responsibleId, studentIds);

    let responsible: NonNullable<
      Awaited<ReturnType<typeof responsiblesQueries.getResponsibleById>>
    >;

    if (d.linkedResponsibleId) {
      const existing = await responsiblesQueries.getResponsibleById(
        this.database.db,
        d.linkedResponsibleId,
        user.clientId,
      );
      if (!existing || !existing.isActive) {
        throw new NotFoundException('Responsável não encontrado.');
      }
      responsible = existing;

      await this.database.db.transaction(async (tx) => {
        for (const link of d.students) {
          await responsiblesQueries.insertResponsibleStudentLink(tx, {
            responsibleId: existing.id,
            studentId: link.studentId,
            relationshipType: link.relationshipType,
            isAuthorizedPickup: link.isAuthorizedPickup,
          });
        }
      });
    } else {
      const wantsAppAccess = Boolean(d.email?.trim() && d.password);
      let linkedUserId: string | null = null;

      if (wantsAppAccess) {
        const existingUser = await this.database.db.query.users.findFirst({
          where: eq(users.email, d.email!),
        });
        if (existingUser) {
          const alreadyInSchool =
            await responsiblesQueries.getResponsibleByUserIdAndClient(
              this.database.db,
              existingUser.id,
              user.clientId,
            );
          if (alreadyInSchool) {
            throw new ConflictException(
              'Este e-mail já está vinculado a um responsável nesta escola.',
            );
          }
          linkedUserId = existingUser.id;
        }
      }

      const created = await this.database.db.transaction(async (tx) => {
        let userId: string | null = linkedUserId;

        if (wantsAppAccess && !linkedUserId) {
          userId = crypto.randomUUID();
          const hashed = await bcrypt.hash(d.password!, 10);
          await tx.insert(users).values({
            id: userId,
            email: d.email!,
            password: hashed,
            name: d.name,
            role: 'member',
            isActive: true,
          });
        }

        const row = await responsiblesQueries.insertResponsible(tx, {
          clientId: user.clientId,
          userId,
          name: d.name,
          phone: d.phone ?? null,
          document: d.document ?? null,
          isActive: d.isActive,
        });

        if (!row) {
          throw new BadRequestException(
            'Não foi possível cadastrar o responsável.',
          );
        }

        for (const link of d.students) {
          await responsiblesQueries.insertResponsibleStudentLink(tx, {
            responsibleId: row.id,
            studentId: link.studentId,
            relationshipType: link.relationshipType,
            isAuthorizedPickup: link.isAuthorizedPickup,
          });
        }

        return row;
      });

      responsible = created;
    }

    if (!d.linkedResponsibleId && d.imageBase64) {
      const buffer = Buffer.from(
        d.imageBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, ''),
        'base64',
      );
      if (buffer.length >= 256 && (await isPortraitImageUsable(buffer))) {
        await this.syncResponsibleFace({
          clientId: user.clientId,
          responsibleId: responsible.id,
          name: d.name,
          imageBuffer: buffer,
          logContext: `managed-responsible=${responsible.id}`,
        });
      }
    } else if (!d.linkedResponsibleId && responsible.userId && !d.imageBase64) {
      await this.copyFaceFromExistingResponsibleIfAvailable({
        userId: responsible.userId,
        clientId: user.clientId,
        responsibleId: responsible.id,
        name: d.name,
        logContext: `managed-responsible=${responsible.id}`,
      });
    }

    if (d.vehicle) {
      try {
        const vehicle = await vehicleQueries.vehicleInsert(this.database.db, {
          clientId: user.clientId,
          responsibleId: responsible.id,
          plate: d.vehicle.plate,
          brand: d.vehicle.brand,
          model: d.vehicle.model,
          color: d.vehicle.color,
        });
        if (vehicle) {
          await this.lprPlateSync.syncVehiclePlateOnCameras({
            clientId: user.clientId,
            vehicleId: vehicle.id,
            plate: d.vehicle.plate,
            ownerDisplayName: d.name,
            vehicleColor: d.vehicle.color,
            logContext: `managed-responsible=${responsible.id}`,
          });
        }
      } catch {
        // veículo opcional — não falha o cadastro principal
      }
    }

    return {
      id: responsible.id,
      name: responsible.name,
      email: d.email ?? null,
    };
  }

  async listManagedResponsibles(user: JwtPayload) {
    this.assertResponsibleJwt(user);
    const householdIds = await responsiblesQueries.listHouseholdResponsibleIds(
      this.database.db,
      user.responsibleId,
      user.clientId,
    );
    const peers = householdIds.filter((id) => id !== user.responsibleId);
    const rows = await Promise.all(
      peers.map((id) =>
        responsiblesQueries.getResponsibleById(
          this.database.db,
          id,
          user.clientId,
        ),
      ),
    );
    return rows.filter(Boolean);
  }

  async deleteManagedResponsible(
    user: JwtPayload,
    targetResponsibleId: string,
  ): Promise<{
    removed: true;
    mode: 'unlinked' | 'deactivated';
    id: string;
  }> {
    this.assertResponsibleJwt(user);

    if (targetResponsibleId === user.responsibleId) {
      throw new BadRequestException('Você não pode excluir a própria conta.');
    }

    const isParent = await responsiblesQueries.responsibleHasParentRelationship(
      this.database.db,
      user.responsibleId,
    );
    if (!isParent) {
      throw new ForbiddenException(
        'Apenas pai/mãe podem excluir outro responsável.',
      );
    }

    const householdIds = await responsiblesQueries.listHouseholdResponsibleIds(
      this.database.db,
      user.responsibleId,
      user.clientId,
    );
    if (!householdIds.includes(targetResponsibleId)) {
      throw new NotFoundException('Responsável não encontrado.');
    }

    const target = await responsiblesQueries.getResponsibleById(
      this.database.db,
      targetResponsibleId,
      user.clientId,
    );
    if (!target || !target.isActive) {
      throw new NotFoundException('Responsável não encontrado.');
    }

    const shouldPartialUnlink =
      await responsiblesQueries.shouldPartialUnlinkManagedResponsible(
        this.database.db,
        user.responsibleId,
        targetResponsibleId,
      );

    if (shouldPartialUnlink) {
      return this.unlinkManagedResponsibleFromHousehold(user, target);
    }

    return this.deactivateManagedResponsible(user, target);
  }

  private async unlinkManagedResponsibleFromHousehold(
    user: JwtPayload & { clientId: string; responsibleId: string },
    target: NonNullable<
      Awaited<ReturnType<typeof responsiblesQueries.getResponsibleById>>
    >,
  ): Promise<{ removed: true; mode: 'unlinked'; id: string }> {
    const myStudentIds = await studentsQueries.listStudentIdsForResponsible(
      this.database.db,
      user.responsibleId,
    );
    const removedLinks =
      await responsiblesQueries.deleteResponsibleStudentLinksForStudents(
        this.database.db,
        target.id,
        myStudentIds,
      );
    if (removedLinks.length === 0) {
      throw new NotFoundException('Nenhum vínculo encontrado para remover.');
    }

    try {
      await this.resyncResponsibleFaceTimeSections({
        clientId: user.clientId,
        responsibleId: target.id,
        name: target.name,
        logContext: `unlink-responsible=${target.id}`,
      });
    } catch (err) {
      this.log.warn(
        `Falha ao re-sincronizar zonas de horário após desvincular ${target.id}: ${String(err)}`,
      );
    }

    return { removed: true, mode: 'unlinked', id: target.id };
  }

  private async deactivateManagedResponsible(
    user: JwtPayload & { clientId: string; responsibleId: string },
    target: NonNullable<
      Awaited<ReturnType<typeof responsiblesQueries.getResponsibleById>>
    >,
  ): Promise<{ removed: true; mode: 'deactivated'; id: string }> {
    const targetVehicles = await vehicleQueries.vehicleListByResponsible(
      this.database.db,
      target.id,
      user.clientId,
    );

    const faceId = target.faceId;
    const logContext = `delete-responsible=${target.id}`;

    if (faceId != null) {
      await this.faceSync.removePersonFromReaders({
        clientId: user.clientId,
        faceId,
        logContext,
        requireAll: true,
      });
    }

    for (const vehicle of targetVehicles) {
      await this.lprPlateSync.removePlateFromAllLprCameras(
        user.clientId,
        vehicle.plate,
        logContext,
        { requireAll: true },
      );
    }

    await this.database.db.transaction(async (tx) => {
      await responsiblesQueries.deleteAllResponsibleStudentLinks(tx, target.id);
      await vehicleQueries.vehicleDeleteAllForResponsible(
        tx,
        target.id,
        user.clientId,
      );
      await responsiblesQueries.updateResponsible(
        tx,
        target.id,
        user.clientId,
        {
          isActive: false,
          pushToken: null,
          faceId: null,
          photoKey: null,
          deviceSyncStatus: null,
          deviceSyncedAt: null,
          deviceSyncError: null,
        },
      );
      if (target.userId) {
        const remaining =
          await responsiblesQueries.countActiveResponsiblesByUserId(
            tx,
            target.userId,
          );
        if (remaining === 0) {
          await tx
            .update(users)
            .set({ isActive: false })
            .where(eq(users.id, target.userId));
        }
      }
    });

    return { removed: true, mode: 'deactivated', id: target.id };
  }

  private async resyncResponsibleFaceTimeSections(params: {
    clientId: string;
    responsibleId: string;
    name: string;
    logContext: string;
  }): Promise<void> {
    const row = await responsiblesQueries.getResponsibleWithFaceStatus(
      this.database.db,
      params.responsibleId,
      params.clientId,
    );
    if (!row?.photoKey || row.faceId == null) return;

    const { buffer } = await this.r2.getObjectBytes(row.photoKey);
    if (buffer.length < 256 || !(await isPortraitImageUsable(buffer))) return;

    await responsiblesQueries.updateResponsibleFace(
      this.database.db,
      params.responsibleId,
      params.clientId,
      {
        deviceSyncStatus: 'pending_sync',
        deviceSyncedAt: null,
        deviceSyncError: null,
      },
    );

    const sync = await this.faceSync.syncPersonOnReaders({
      clientId: params.clientId,
      faceId: row.faceId,
      name: params.name,
      imageBuffer: buffer,
      timeSectionIds: await this.accessTimeZone.resolveResponsibleTimeSections(
        params.clientId,
        params.responsibleId,
      ),
      logContext: params.logContext,
    });

    await responsiblesQueries.updateResponsibleFace(
      this.database.db,
      params.responsibleId,
      params.clientId,
      {
        deviceSyncStatus: sync.deviceSyncStatus,
        deviceSyncedAt: sync.deviceSyncStatus === 'synced' ? new Date() : null,
        deviceSyncError: sync.deviceSyncError,
      },
    );
  }

  async createInvitation(user: JwtPayload, body: unknown) {
    this.assertResponsibleJwt(user);
    const parsed = createResponsibleInvitationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const studentIds = parsed.data.students.map((s) => s.studentId);
    await this.assertOwnedStudents(user.responsibleId, studentIds);

    const code = await this.generateUniqueLinkCode();
    const row = await invitationQueries.invitationInsertWithStudents(
      this.database.db,
      {
        clientId: user.clientId,
        inviterResponsibleId: user.responsibleId,
        guestLinkCode: code,
        status: 'pending',
        faceApprovalStatus: 'pending',
        plateApprovalStatus: 'pending',
      },
      parsed.data.students.map((s) => ({
        studentId: s.studentId,
        relationshipType: s.relationshipType,
        isAuthorizedPickup: s.isAuthorizedPickup,
      })),
    );
    if (!row) {
      throw new BadRequestException('Não foi possível criar o convite.');
    }
    const students =
      await invitationQueries.invitationListStudentsForInvitation(
        this.database.db,
        row.id,
      );
    return this.toInvitationResponse(
      row,
      students.map((s) => ({
        studentId: s.studentId,
        name: s.studentName,
        relationshipType: s.relationshipType,
        isAuthorizedPickup: s.isAuthorizedPickup,
      })),
    );
  }

  async listInvitations(user: JwtPayload) {
    this.assertResponsibleJwt(user);
    const rows = await invitationQueries.invitationListByInviter(
      this.database.db,
      user.responsibleId,
      user.clientId,
    );
    return this.enrichInvitations(rows);
  }

  async getInvitationFaceUrl(user: JwtPayload, id: string) {
    this.assertResponsibleJwt(user);
    const row = await this.assertOwnedInvitation(
      id,
      user.clientId,
      user.responsibleId,
    );
    if (!row.faceImageKey) {
      throw new BadRequestException('O convidado ainda não enviou a foto.');
    }
    const url = await this.r2.createPresignedPortraitGetUrl(row.faceImageKey);
    if (!url) {
      throw new BadRequestException(
        'Não foi possível carregar a prévia da foto.',
      );
    }
    return { url };
  }

  async approveFace(user: JwtPayload, id: string) {
    this.assertResponsibleJwt(user);
    let row = await this.assertOwnedInvitation(
      id,
      user.clientId,
      user.responsibleId,
    );
    if (row.status === 'approved') {
      throw new BadRequestException('Este convite já foi aprovado.');
    }
    if (row.faceApprovalStatus !== 'submitted') {
      throw new BadRequestException(
        'Só é possível aprovar após o convidado enviar a foto.',
      );
    }
    if (!row.faceImageKey) {
      throw new BadRequestException('Foto do convidado não encontrada.');
    }

    row = (await invitationQueries.invitationUpdate(
      this.database.db,
      id,
      user.clientId,
      { faceApprovalStatus: 'approved' },
    ))!;

    if (!this.plateRequired(row)) {
      row = (await invitationQueries.invitationUpdate(
        this.database.db,
        id,
        user.clientId,
        { plateApprovalStatus: 'approved' },
      ))!;
    }

    if (this.canFinalize(row)) {
      await this.createResponsibleFromInvitation(row);
    }

    const students =
      await invitationQueries.invitationListStudentsForInvitation(
        this.database.db,
        id,
      );
    const updated = await invitationQueries.invitationGetById(
      this.database.db,
      id,
      user.clientId,
    );
    return this.toInvitationResponse(
      updated,
      students.map((s) => ({
        studentId: s.studentId,
        name: s.studentName,
        relationshipType: s.relationshipType,
        isAuthorizedPickup: s.isAuthorizedPickup,
      })),
    );
  }

  async rejectFace(user: JwtPayload, id: string) {
    this.assertResponsibleJwt(user);
    const row = await this.assertOwnedInvitation(
      id,
      user.clientId,
      user.responsibleId,
    );
    if (row.faceApprovalStatus !== 'submitted') {
      throw new BadRequestException(
        'Só é possível recusar após o convidado enviar a foto.',
      );
    }
    const updated = await invitationQueries.invitationUpdate(
      this.database.db,
      id,
      user.clientId,
      {
        faceApprovalStatus: 'rejected',
        faceImageKey: null,
        status: 'rejected',
      },
    );
    const students =
      await invitationQueries.invitationListStudentsForInvitation(
        this.database.db,
        id,
      );
    return this.toInvitationResponse(
      updated,
      students.map((s) => ({
        studentId: s.studentId,
        name: s.studentName,
        relationshipType: s.relationshipType,
        isAuthorizedPickup: s.isAuthorizedPickup,
      })),
    );
  }

  async approvePlate(user: JwtPayload, id: string) {
    this.assertResponsibleJwt(user);
    let row = await this.assertOwnedInvitation(
      id,
      user.clientId,
      user.responsibleId,
    );
    if (!this.plateRequired(row)) {
      throw new BadRequestException('Este convite não possui veículo.');
    }
    if (row.plateApprovalStatus !== 'submitted') {
      throw new BadRequestException(
        'Só é possível aprovar após o convidado informar a placa.',
      );
    }

    row = (await invitationQueries.invitationUpdate(
      this.database.db,
      id,
      user.clientId,
      { plateApprovalStatus: 'approved' },
    ))!;

    if (this.canFinalize(row)) {
      await this.createResponsibleFromInvitation(row);
    }

    const students =
      await invitationQueries.invitationListStudentsForInvitation(
        this.database.db,
        id,
      );
    const updated = await invitationQueries.invitationGetById(
      this.database.db,
      id,
      user.clientId,
    );
    return this.toInvitationResponse(
      updated,
      students.map((s) => ({
        studentId: s.studentId,
        name: s.studentName,
        relationshipType: s.relationshipType,
        isAuthorizedPickup: s.isAuthorizedPickup,
      })),
    );
  }

  async rejectPlate(user: JwtPayload, id: string) {
    this.assertResponsibleJwt(user);
    const current = await this.assertOwnedInvitation(
      id,
      user.clientId,
      user.responsibleId,
    );
    if (!this.plateRequired(current)) {
      throw new BadRequestException('Este convite não possui veículo.');
    }
    if (current.plateApprovalStatus !== 'submitted') {
      throw new BadRequestException(
        'Só é possível recusar após o convidado informar a placa.',
      );
    }
    let updated = await invitationQueries.invitationUpdate(
      this.database.db,
      id,
      user.clientId,
      {
        plateApprovalStatus: 'rejected',
        vehiclePlate: null,
        vehicleBrand: null,
        vehicleModel: null,
        vehicleColor: null,
      },
    );
    if (updated?.faceApprovalStatus === 'approved') {
      updated = await invitationQueries.invitationUpdate(
        this.database.db,
        id,
        user.clientId,
        { plateApprovalStatus: 'approved' },
      );
      if (updated) {
        await this.createResponsibleFromInvitation(updated);
        updated =
          (await invitationQueries.invitationGetById(
            this.database.db,
            id,
            user.clientId,
          )) ?? updated;
      }
    }
    const students =
      await invitationQueries.invitationListStudentsForInvitation(
        this.database.db,
        id,
      );
    return this.toInvitationResponse(
      updated,
      students.map((s) => ({
        studentId: s.studentId,
        name: s.studentName,
        relationshipType: s.relationshipType,
        isAuthorizedPickup: s.isAuthorizedPickup,
      })),
    );
  }

  async cancelInvitation(user: JwtPayload, id: string) {
    this.assertResponsibleJwt(user);
    const row = await this.assertOwnedInvitation(
      id,
      user.clientId,
      user.responsibleId,
    );
    if (row.status === 'approved' || row.status === 'cancelled') {
      throw new BadRequestException('Este convite não pode ser cancelado.');
    }
    const updated = await invitationQueries.invitationUpdate(
      this.database.db,
      id,
      user.clientId,
      { status: 'cancelled' },
    );
    const students =
      await invitationQueries.invitationListStudentsForInvitation(
        this.database.db,
        id,
      );
    return this.toInvitationResponse(
      updated,
      students.map((s) => ({
        studentId: s.studentId,
        name: s.studentName,
        relationshipType: s.relationshipType,
        isAuthorizedPickup: s.isAuthorizedPickup,
      })),
    );
  }

  async getInvitationByLinkCode(code: string) {
    return invitationQueries.invitationGetByGuestLinkCode(
      this.database.db,
      code,
    );
  }

  emitInvitationSubmitted(payload: ResponsibleInvitationSubmittedPayload) {
    this.eventEmitter.emit(RESPONSIBLE_INVITATION_SUBMITTED, payload);
  }
}
