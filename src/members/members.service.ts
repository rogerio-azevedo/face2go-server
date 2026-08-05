import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import * as clientsQueries from '../database/queries/clients.queries';
import * as membersQueries from '../database/queries/members.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import * as shiftsQueries from '../database/queries/shifts.queries';
import * as vehicleQueries from '../database/queries/vehicles.queries';
import { DatabaseService } from '../database/database.service';
import { users } from '../database/schema';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { AccessTimeZoneService } from '../face-sync/access-time-zone.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PersonLookupService } from '../people/person-lookup.service';
import { PersonProfileService } from '../people/person-profile.service';
import { R2StorageService } from '../storage/r2-storage.service';
import {
  buildPaginatedResult,
  parseListPaginationParams,
  type ListPaginationParams,
} from '../common/pagination';
import {
  createClientRoleSchema,
  createMemberSchema,
  updateClientRoleSchema,
  updateMemberSchema,
} from '../validation/members.schema';
import { zodFirstMessage } from '../validation/zod-utils';
import * as usersQueries from '../database/queries/users.queries';
import { normalizeCpf } from '../auth/utils/auth-identifiers';

function mapMemberRow(
  row: membersQueries.MemberWithRoleRow,
  photoUrl: string | null,
  hasFacialReaders: boolean,
) {
  return {
    id: row.id,
    clientId: row.clientId,
    roleId: row.roleId,
    roleName: row.roleName,
    roleSlug: row.roleSlug,
    shiftId: row.shiftId,
    shiftName: row.shiftName,
    userId: row.userId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    document: row.document,
    birthDate: row.birthDate,
    photoKey: row.photoKey,
    photoUrl,
    faceId: row.faceId,
    deviceSyncStatus: row.deviceSyncStatus,
    deviceSyncedAt: row.deviceSyncedAt
      ? row.deviceSyncedAt.toISOString()
      : null,
    deviceSyncError: row.deviceSyncError,
    additionalData: row.additionalData,
    isActive: row.isActive,
    canEnrollStudentFace: row.canEnrollStudentFace,
    canEnrollMemberFace: row.canEnrollMemberFace,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    hasFacialReaders,
  };
}

@Injectable()
export class MembersService {
  private readonly log = new Logger(MembersService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly r2Storage: R2StorageService,
    private readonly faceSync: FaceSyncService,
    private readonly accessTimeZone: AccessTimeZoneService,
    private readonly personLookup: PersonLookupService,
    private readonly personProfile: PersonProfileService,
  ) {}

  private ensureCompany(user: JwtPayload): string {
    const companyId = user.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Sem permissão.');
    }
    return companyId;
  }

  private async assertManageClient(user: JwtPayload, clientId: string) {
    if (user.role === 'client_admin') {
      const tenantClientId = user.clientId ?? undefined;
      if (!tenantClientId || tenantClientId !== clientId) {
        throw new ForbiddenException('Sem permissão.');
      }
      const client = await clientsQueries.getClientByIdOnly(
        this.database.db,
        clientId,
      );
      if (!client) {
        throw new NotFoundException('Cliente não encontrado.');
      }
      return client;
    }

    if (user.role !== 'company_admin' && user.role !== 'company_operator') {
      throw new ForbiddenException('Sem permissão.');
    }

    const companyId = this.ensureCompany(user);

    if (user.role === 'company_admin') {
      const client = await clientsQueries.getClientById(
        this.database.db,
        clientId,
        companyId,
      );
      if (!client) {
        throw new NotFoundException('Cliente não encontrado.');
      }
      return client;
    }

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
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    return client;
  }

  private async optionalPhotoUrl(
    photoKey: string | null,
  ): Promise<string | null> {
    if (!photoKey) return null;
    try {
      return await this.r2Storage.createPresignedPortraitGetUrl(photoKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(
        `URL assinada (membro/R2): falha para key="${photoKey}": ${msg}`,
      );
      return null;
    }
  }

  async listRoles(user: JwtPayload, clientId: string) {
    const client = await this.assertManageClient(user, clientId);
    await membersQueries.seedDefaultRolesForClient(
      this.database.db,
      clientId,
      client.type,
    );
    const rows = await membersQueries.listClientRoles(
      this.database.db,
      clientId,
    );
    return rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      name: r.name,
      slug: r.slug,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async createRole(user: JwtPayload, clientId: string, body: unknown) {
    await this.assertManageClient(user, clientId);
    const parsed = createClientRoleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    const existing = await membersQueries.getClientRoleBySlug(
      this.database.db,
      clientId,
      d.slug,
    );
    if (existing) {
      throw new ConflictException('Já existe uma função com este slug.');
    }
    const row = await membersQueries.insertClientRole(this.database.db, {
      clientId,
      name: d.name,
      slug: d.slug,
      isActive: d.isActive,
    });
    return {
      id: row.id,
      clientId: row.clientId,
      name: row.name,
      slug: row.slug,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async updateRole(
    user: JwtPayload,
    clientId: string,
    roleId: string,
    body: unknown,
  ) {
    await this.assertManageClient(user, clientId);
    const parsed = updateClientRoleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    if (
      d.name === undefined &&
      d.slug === undefined &&
      d.isActive === undefined
    ) {
      throw new BadRequestException('Nada para atualizar.');
    }
    if (d.slug !== undefined) {
      const existing = await membersQueries.getClientRoleBySlug(
        this.database.db,
        clientId,
        d.slug,
      );
      if (existing && existing.id !== roleId) {
        throw new ConflictException('Já existe uma função com este slug.');
      }
    }
    const updated = await membersQueries.updateClientRole(
      this.database.db,
      roleId,
      clientId,
      d,
    );
    if (!updated) {
      throw new NotFoundException('Função não encontrada.');
    }
    return {
      id: updated.id,
      clientId: updated.clientId,
      name: updated.name,
      slug: updated.slug,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async list(
    user: JwtPayload,
    clientId: string,
    query: ListPaginationParams & { roleId?: string } = {},
  ) {
    await this.assertManageClient(user, clientId);
    const { page, pageSize, search, offset } = parseListPaginationParams(
      query.page !== undefined ? String(query.page) : undefined,
      query.pageSize !== undefined ? String(query.pageSize) : undefined,
      query.search,
    );
    const [total, rows, hasFacialReaders] = await Promise.all([
      membersQueries.countMembersByClient(this.database.db, clientId, {
        search,
        roleId: query.roleId,
      }),
      membersQueries.listMembersByClientWithRole(this.database.db, clientId, {
        search,
        roleId: query.roleId,
        offset,
        limit: pageSize,
      }),
      this.faceSync.hasActiveFacialReaders(clientId),
    ]);
    const data = await Promise.all(
      rows.map(async (row) =>
        mapMemberRow(row, await this.optionalPhotoUrl(row.photoKey), hasFacialReaders),
      ),
    );
    return buildPaginatedResult(data, total, page, pageSize);
  }

  async getById(user: JwtPayload, clientId: string, memberId: string) {
    await this.assertManageClient(user, clientId);
    const row = await membersQueries.getMemberWithRoleById(
      this.database.db,
      memberId,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Membro não encontrado.');
    }
    const hasFacialReaders = await this.faceSync.hasActiveFacialReaders(clientId);
    return mapMemberRow(row, await this.optionalPhotoUrl(row.photoKey), hasFacialReaders);
  }

  async lookupPerson(user: JwtPayload, clientId: string, query: unknown) {
    await this.assertManageClient(user, clientId);
    return this.personLookup.lookup(query);
  }

  async create(user: JwtPayload, clientId: string, body: unknown) {
    const client = await this.assertManageClient(user, clientId);
    await membersQueries.seedDefaultRolesForClient(
      this.database.db,
      clientId,
      client.type,
    );
    const parsed = createMemberSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;

    const role = await membersQueries.getClientRoleById(
      this.database.db,
      d.roleId,
      clientId,
    );
    if (!role || !role.isActive) {
      throw new BadRequestException('Função inválida ou inativa.');
    }

    if (d.shiftId) {
      const shift = await shiftsQueries.getShiftById(
        this.database.db,
        d.shiftId,
        clientId,
      );
      if (!shift || !shift.isActive) {
        throw new BadRequestException('Horário inválido ou inativo.');
      }
    }

    const resolved = await this.personLookup.resolvePerson({
      cpf: d.document ?? undefined,
      email: d.email,
    });
    if (resolved.conflict) {
      throw new ConflictException(resolved.conflict);
    }

    let userId: string;
    let createdUser = false;

    if (resolved.matched && resolved.userId) {
      if (
        await membersQueries.getMemberByUserIdAndClient(
          this.database.db,
          resolved.userId,
          clientId,
        )
      ) {
        throw new ConflictException(
          'Este e-mail já está vinculado a um membro neste cliente.',
        );
      }
      userId = resolved.userId;
    } else {
      if (!d.password) {
        throw new BadRequestException(
          resolved.matched
            ? 'Informe a senha para criar a conta de login.'
            : 'Informe a senha para o novo cadastro.',
        );
      }

      const existingUser = await usersQueries.findUserByEmail(
        this.database.db,
        d.email,
      );
      if (existingUser) {
        throw new ConflictException('E-mail já cadastrado.');
      }

      userId = crypto.randomUUID();
      createdUser = true;
      const hashed = await bcrypt.hash(d.password, 10);
      const normalizedCpf = d.document ? normalizeCpf(d.document) : null;

      await this.database.db.insert(users).values({
        id: userId,
        email: d.email,
        password: hashed,
        name: d.name,
        cpf: normalizedCpf?.length === 11 ? normalizedCpf : null,
        role: 'member',
        isActive: true,
      });
    }

    if (!createdUser && d.document) {
      await usersQueries.updateUserCpfIfMissing(
        this.database.db,
        userId,
        d.document,
      );
    }

    try {
      if (d.document) {
        await this.personLookup.linkLegacyProfilesByDocument(
          d.document,
          userId,
        );
      }

      const row = await membersQueries.insertMember(this.database.db, {
        clientId,
        roleId: d.roleId,
        shiftId: d.shiftId ?? null,
        userId,
        name: d.name,
        email: d.email,
        phone: d.phone ?? null,
        document: d.document ? normalizeCpf(d.document) : null,
        birthDate: d.birthDate ?? null,
        isActive: d.isActive,
      });

      const bondRef = { type: 'member' as const, id: row.id, name: d.name };
      const appliedSameClient =
        await this.personProfile.applySharedFaceFromSameClient(
          userId,
          clientId,
          bondRef,
        );
      if (!appliedSameClient) {
        await this.personProfile.copyFaceFromOtherClientToBond(
          userId,
          clientId,
          bondRef,
          `create-member=${row.id}`,
        );
      }

      return this.getById(user, clientId, row.id);
    } catch {
      if (createdUser) {
        await this.database.db.delete(users).where(eq(users.id, userId));
      }
      throw new BadRequestException('Não foi possível cadastrar o membro.');
    }
  }

  async update(
    user: JwtPayload,
    clientId: string,
    memberId: string,
    body: unknown,
  ) {
    await this.assertManageClient(user, clientId);
    const parsed = updateMemberSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;
    if (
      d.name === undefined &&
      d.email === undefined &&
      d.phone === undefined &&
      d.document === undefined &&
      d.birthDate === undefined &&
      d.password === undefined &&
      d.isActive === undefined &&
      d.roleId === undefined &&
      d.shiftId === undefined &&
      d.canEnrollStudentFace === undefined &&
      d.canEnrollMemberFace === undefined
    ) {
      throw new BadRequestException('Nada para atualizar.');
    }

    let existing = await membersQueries.getMemberById(
      this.database.db,
      memberId,
      clientId,
    );
    if (!existing) {
      throw new NotFoundException('Membro não encontrado.');
    }

    if (d.roleId !== undefined) {
      const role = await membersQueries.getClientRoleById(
        this.database.db,
        d.roleId,
        clientId,
      );
      if (!role || !role.isActive) {
        throw new BadRequestException('Função inválida ou inativa.');
      }
    }

    if (d.shiftId) {
      const shift = await shiftsQueries.getShiftById(
        this.database.db,
        d.shiftId,
        clientId,
      );
      if (!shift || !shift.isActive) {
        throw new BadRequestException('Horário inválido ou inativo.');
      }
    }

    if (d.email !== undefined) {
      if (!existing.userId) {
        if (d.password === undefined) {
          throw new BadRequestException(
            'Informe a senha para criar a conta de login.',
          );
        }
        const emailTaken = await this.database.db.query.users.findFirst({
          where: eq(users.email, d.email),
        });
        if (emailTaken) {
          throw new ConflictException('E-mail já cadastrado.');
        }
        const userId = crypto.randomUUID();
        const hashed = await bcrypt.hash(d.password, 10);
        await this.database.db.insert(users).values({
          id: userId,
          email: d.email,
          password: hashed,
          name: d.name ?? existing.name,
          role: 'member',
          isActive: true,
        });
        await membersQueries.linkUserToMember(
          this.database.db,
          memberId,
          clientId,
          userId,
        );
        existing = (await membersQueries.getMemberById(
          this.database.db,
          memberId,
          clientId,
        ))!;
      } else {
        const emailTaken = await this.database.db.query.users.findFirst({
          where: eq(users.email, d.email),
        });
        if (emailTaken && emailTaken.id !== existing.userId) {
          throw new ConflictException('E-mail já cadastrado.');
        }
        await this.database.db
          .update(users)
          .set({
            email: d.email,
            ...(d.password !== undefined
              ? { password: await bcrypt.hash(d.password, 10) }
              : {}),
            ...(d.name !== undefined ? { name: d.name } : {}),
          })
          .where(eq(users.id, existing.userId));
      }
    } else if (d.password !== undefined && existing.userId) {
      await this.database.db
        .update(users)
        .set({
          password: await bcrypt.hash(d.password, 10),
        })
        .where(eq(users.id, existing.userId));
    }

    await membersQueries.updateMember(this.database.db, memberId, clientId, {
      ...(d.roleId !== undefined ? { roleId: d.roleId } : {}),
      ...(d.shiftId !== undefined ? { shiftId: d.shiftId } : {}),
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.email !== undefined ? { email: d.email } : {}),
      ...(d.phone !== undefined ? { phone: d.phone } : {}),
      ...(d.document !== undefined ? { document: d.document } : {}),
      ...(d.birthDate !== undefined ? { birthDate: d.birthDate } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      ...(d.canEnrollStudentFace !== undefined
        ? { canEnrollStudentFace: d.canEnrollStudentFace }
        : {}),
      ...(d.canEnrollMemberFace !== undefined
        ? { canEnrollMemberFace: d.canEnrollMemberFace }
        : {}),
    });

    return this.getById(user, clientId, memberId);
  }

  async syncFaceByCompany(
    user: JwtPayload,
    clientId: string,
    memberId: string,
  ): Promise<{
    deviceSyncStatus: 'synced' | 'sync_failed' | 'pending_sync';
    deviceSyncError: string | null;
  }> {
    await this.assertManageClient(user, clientId);
    const row = await membersQueries.getMemberWithFaceStatus(
      this.database.db,
      memberId,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Membro não encontrado.');
    }
    if (!row.photoKey || row.faceId == null) {
      throw new BadRequestException('Sem foto cadastrada para sincronizar.');
    }

    let buffer: Buffer;
    try {
      const got = await this.r2Storage.getObjectBytes(row.photoKey);
      buffer = got.buffer;
    } catch {
      throw new BadRequestException(
        'Não foi possível obter a foto armazenada.',
      );
    }
    if (buffer.length < 256) {
      throw new BadRequestException(
        'Imagem armazenada inválida ou muito pequena.',
      );
    }

    await membersQueries.updateMemberFace(
      this.database.db,
      memberId,
      clientId,
      {
        deviceSyncStatus: 'pending_sync',
        deviceSyncedAt: null,
        deviceSyncError: null,
      },
    );

    const sync = await this.faceSync.syncPersonOnReaders({
      clientId,
      faceId: row.faceId,
      name: row.name,
      imageBuffer: buffer,
      timeSectionIds: await this.accessTimeZone.resolveMemberTimeSections(
        clientId,
        memberId,
      ),
      logContext: `member-sync=${memberId}`,
    });

    await membersQueries.updateMemberFace(
      this.database.db,
      memberId,
      clientId,
      {
        deviceSyncStatus: sync.deviceSyncStatus,
        deviceSyncedAt: sync.deviceSyncStatus === 'synced' ? new Date() : null,
        deviceSyncError: sync.deviceSyncError,
      },
    );

    if (row.userId) {
      await this.personProfile.propagateFaceToSiblings(
        row.userId,
        clientId,
        {
          faceId: row.faceId,
          photoKey: row.photoKey,
          deviceSyncStatus: sync.deviceSyncStatus,
          deviceSyncedAt:
            sync.deviceSyncStatus === 'synced' ? new Date() : null,
          deviceSyncError: sync.deviceSyncError,
        },
        { memberId },
      );
    }

    return {
      deviceSyncStatus: sync.deviceSyncStatus,
      deviceSyncError: sync.deviceSyncError,
    };
  }

  async delete(user: JwtPayload, clientId: string, memberId: string) {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    await this.assertManageClient(user, clientId);

    const target = await membersQueries.getMemberById(
      this.database.db,
      memberId,
      clientId,
    );
    if (!target) {
      throw new NotFoundException('Membro não encontrado.');
    }

    const memberVehicles = await vehicleQueries.vehicleListByMember(
      this.database.db,
      target.id,
      clientId,
    );

    const faceId = target.faceId;
    const logContext = `delete-member=${target.id}`;

    if (faceId != null) {
      const removeFromReader =
        await this.personProfile.shouldRemoveFaceFromReader(faceId, clientId, {
          memberId: target.id,
        });
      if (removeFromReader) {
        try {
          await this.faceSync.removePersonFromReaders({
            clientId,
            faceId,
            logContext,
          });
        } catch (e: unknown) {
          this.log.warn(
            `${logContext} remove face: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    for (const v of memberVehicles) {
      try {
        await vehicleQueries.vehicleDeleteById(
          this.database.db,
          v.id,
          clientId,
        );
      } catch (e: unknown) {
        this.log.warn(
          `${logContext} remove vehicle ${v.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (target.photoKey) {
      this.log.warn(
        `${logContext} foto R2 não removida automaticamente (key=${target.photoKey})`,
      );
    }

    const removed = await membersQueries.deleteMember(
      this.database.db,
      memberId,
      clientId,
    );
    if (!removed) {
      throw new NotFoundException('Membro não encontrado.');
    }
    return { removed: true, id: memberId };
  }

  /** Cria ou atualiza membro a partir de registration aprovada (não-escola). */
  async upsertFromApprovedRegistration(
    registration: registrationsQueries.RegistrationRow,
    clientType: string,
  ) {
    const existingByReg = await membersQueries.getMemberByRegistrationId(
      this.database.db,
      registration.id,
    );
    if (existingByReg) {
      return existingByReg;
    }

    await membersQueries.seedDefaultRolesForClient(
      this.database.db,
      registration.clientId,
      clientType,
    );

    const roleSlug =
      clientType === 'condominium'
        ? 'morador'
        : clientType === 'school'
          ? 'funcionario'
          : 'autorizado';

    const role = await membersQueries.getClientRoleBySlug(
      this.database.db,
      registration.clientId,
      roleSlug,
    );
    if (!role) {
      throw new BadRequestException(
        `Função padrão "${roleSlug}" não encontrada.`,
      );
    }

    return membersQueries.insertMember(this.database.db, {
      clientId: registration.clientId,
      roleId: role.id,
      registrationId: registration.id,
      name: registration.name?.trim() || 'Sem nome',
      email: registration.email,
      phone: registration.phone,
      document: registration.document,
      photoKey: registration.faceImageKey,
      faceId: registration.faceId,
      deviceSyncStatus: registration.deviceSyncStatus,
      deviceSyncedAt: registration.deviceSyncedAt,
      deviceSyncError: registration.deviceSyncError,
      additionalData: registration.additionalData,
      isActive: true,
    });
  }
}
