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
import * as peopleQueries from '../database/queries/people.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import * as vehicleQueries from '../database/queries/vehicles.queries';
import { DatabaseService } from '../database/database.service';
import { users, responsibles } from '../database/schema';
import {
  isPhotoKeyAliasedTo,
  parseBondPhotoKey,
} from '../people/face-photo-key';
import { AccessTimeZoneService } from '../face-sync/access-time-zone.service';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { LprPlateSyncService } from '../lpr-plate-sync/lpr-plate-sync.service';
import { PersonLookupService } from '../people/person-lookup.service';
import { PersonProfileService } from '../people/person-profile.service';
import { SchoolAccessService } from '../school-access/school-access.service';
import { R2StorageService } from '../storage/r2-storage.service';
import {
  buildPaginatedResult,
  parseListPaginationParams,
  type ListPaginationParams,
} from '../common/pagination';
import { blockPersonSchema } from '../validation/block-person.schema';
import {
  createResponsibleSchema,
  linkResponsibleStudentSchema,
  updateResponsibleSchema,
  updateResponsibleStudentLinkSchema,
} from '../validation/responsibles.schema';
import { zodFirstMessage } from '../validation/zod-utils';
import * as usersQueries from '../database/queries/users.queries';
import { normalizeCpf } from '../auth/utils/auth-identifiers';

@Injectable()
export class ResponsiblesService {
  private readonly log = new Logger(ResponsiblesService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly schoolAccess: SchoolAccessService,
    private readonly r2Storage: R2StorageService,
    private readonly faceSync: FaceSyncService,
    private readonly accessTimeZone: AccessTimeZoneService,
    private readonly lprPlateSync: LprPlateSyncService,
    private readonly personLookup: PersonLookupService,
    private readonly personProfile: PersonProfileService,
  ) {}

  async list(
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
    const [total, rows, hasFacialReaders] = await Promise.all([
      responsiblesQueries.countResponsiblesByClient(
        this.database.db,
        clientId,
        {
          search,
        },
      ),
      responsiblesQueries.listResponsiblesByClientWithEmail(
        this.database.db,
        clientId,
        { search, offset, limit: pageSize },
      ),
      this.faceSync.hasActiveFacialReaders(clientId),
    ]);
    const sharedUserIds =
      await peopleQueries.findUserIdsSharedAcrossDistinctDocuments(
        this.database.db,
        rows.map((row) => row.userId).filter((id): id is string => Boolean(id)),
      );
    const data = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        loginShared: Boolean(row.userId && sharedUserIds.has(row.userId)),
        photoUrl: await this.optionalPhotoUrl(row.photoKey),
        hasFacialReaders,
      })),
    );
    return buildPaginatedResult(data, total, page, pageSize);
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
        `URL assinada (responsável/R2): falha para key="${photoKey}": ${msg}`,
      );
      return null;
    }
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
    const email = row.userId
      ? await responsiblesQueries.getResponsibleEmailByUserId(
          this.database.db,
          row.userId,
        )
      : null;
    const loginShared = row.userId
      ? await peopleQueries.userHasBondsWithDifferentDocument(
          this.database.db,
          {
            userId: row.userId,
            document: row.document,
            excludeResponsibleId: row.id,
          },
        )
      : false;
    return {
      ...row,
      email,
      loginShared,
      photoUrl: await this.optionalPhotoUrl(row.photoKey),
    };
  }

  async lookupPerson(user: JwtPayload, clientId: string, query: unknown) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    return this.personLookup.lookup(query);
  }

  async create(user: JwtPayload, clientId: string, body: unknown) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const parsed = createResponsibleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const d = parsed.data;

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
        await responsiblesQueries.getResponsibleByUserIdAndClient(
          this.database.db,
          resolved.userId,
          clientId,
        )
      ) {
        throw new ConflictException(
          'Este e-mail já está vinculado a um responsável nesta escola.',
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

      const responsible = await responsiblesQueries.insertResponsible(
        this.database.db,
        {
          clientId,
          userId,
          name: d.name,
          phone: d.phone ?? null,
          document: d.document ? normalizeCpf(d.document) : null,
          isActive: d.isActive,
        },
      );

      const bondRef = {
        type: 'responsible' as const,
        id: responsible.id,
        name: d.name,
      };
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
          `create-responsible=${responsible.id}`,
        );
      }

      return responsible;
    } catch {
      if (createdUser) {
        await this.database.db.delete(users).where(eq(users.id, userId));
      }
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
      d.email === undefined &&
      d.phone === undefined &&
      d.document === undefined &&
      d.password === undefined &&
      d.isActive === undefined
    ) {
      throw new BadRequestException('Nada para atualizar.');
    }

    let existing = await responsiblesQueries.getResponsibleById(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!existing) {
      throw new NotFoundException('Responsável não encontrado.');
    }

    if (d.email !== undefined || d.password !== undefined) {
      existing = await this.splitSharedLoginIfNeeded(
        existing,
        clientId,
        responsibleId,
        {
          email: d.email,
          password: d.password,
          name: d.name,
        },
      );
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
        await responsiblesQueries.linkUserToResponsible(
          this.database.db,
          responsibleId,
          clientId,
          userId,
        );
        existing = {
          ...existing,
          userId,
        };
      } else {
        const emailTaken = await this.database.db.query.users.findFirst({
          where: eq(users.email, d.email),
        });
        if (emailTaken && emailTaken.id !== existing.userId) {
          throw new ConflictException('E-mail já cadastrado.');
        }
        await this.database.db
          .update(users)
          .set({ email: d.email })
          .where(eq(users.id, existing.userId));
      }
    }

    if (d.password !== undefined) {
      if (!existing.userId) {
        throw new BadRequestException(
          'Informe o e-mail para criar a conta de login.',
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

    const effectiveUserId = updated.userId ?? existing.userId;
    if (d.name !== undefined && effectiveUserId) {
      await this.database.db
        .update(users)
        .set({ name: d.name })
        .where(eq(users.id, effectiveUserId));
    }

    const email = effectiveUserId
      ? await responsiblesQueries.getResponsibleEmailByUserId(
          this.database.db,
          effectiveUserId,
        )
      : null;

    return {
      ...updated,
      email,
      photoUrl: await this.optionalPhotoUrl(updated.photoKey),
    };
  }

  /**
   * Se este responsável compartilha a conta de login com outra pessoa (CPF
   * diferente), cria um user próprio antes de mutar e-mail/senha.
   */
  private async splitSharedLoginIfNeeded(
    existing: NonNullable<
      Awaited<ReturnType<typeof responsiblesQueries.getResponsibleById>>
    >,
    clientId: string,
    responsibleId: string,
    d: { email?: string; password?: string; name?: string },
  ) {
    if (!existing.userId) return existing;

    const shared = await peopleQueries.userHasBondsWithDifferentDocument(
      this.database.db,
      {
        userId: existing.userId,
        document: existing.document,
        excludeResponsibleId: existing.id,
      },
    );
    if (!shared) return existing;

    const accountEmail =
      d.email ?? `nologin-${crypto.randomUUID()}@sem-acesso.face2go`;
    const emailTaken = await this.database.db.query.users.findFirst({
      where: eq(users.email, accountEmail),
    });
    if (emailTaken) {
      throw new ConflictException(
        'E-mail já cadastrado. Informe um e-mail exclusivo para separar a conta deste responsável.',
      );
    }

    const [currentUser] = await this.database.db
      .select({ password: users.password })
      .from(users)
      .where(eq(users.id, existing.userId))
      .limit(1);
    const hashed = d.password
      ? await bcrypt.hash(d.password, 10)
      : (currentUser?.password ?? (await bcrypt.hash(crypto.randomUUID(), 10)));
    const normalizedCpf = existing.document
      ? normalizeCpf(existing.document)
      : null;
    const newUserId = crypto.randomUUID();

    let cpfToSet = normalizedCpf?.length === 11 ? normalizedCpf : null;
    if (cpfToSet) {
      const cpfHolder = await usersQueries.findUserByCpf(
        this.database.db,
        cpfToSet,
      );
      if (cpfHolder?.id === existing.userId) {
        await this.database.db
          .update(users)
          .set({ cpf: null })
          .where(eq(users.id, existing.userId));
      } else if (cpfHolder) {
        cpfToSet = null;
      }
    }

    await this.database.db.insert(users).values({
      id: newUserId,
      email: accountEmail,
      password: hashed,
      name: d.name ?? existing.name,
      cpf: cpfToSet,
      role: 'member',
      isActive: true,
    });
    await responsiblesQueries.linkUserToResponsible(
      this.database.db,
      responsibleId,
      clientId,
      newUserId,
    );

    this.log.warn(
      `Conta compartilhada separada: responsável ${responsibleId} ` +
        `saiu de user ${existing.userId} para ${newUserId}`,
    );

    await this.clearAliasedFacesAfterLoginSplit(
      {
        id: existing.id,
        clientId,
        photoKey: existing.photoKey,
        faceId: existing.faceId,
      },
      existing.userId,
    );

    return { ...existing, userId: newUserId };
  }

  private async clearAliasedFacesAfterLoginSplit(
    row: {
      id: string;
      clientId: string;
      photoKey: string | null;
      faceId: number | null;
    },
    previousUserId: string,
  ) {
    if (
      row.photoKey &&
      isPhotoKeyAliasedTo(row.photoKey, row.clientId, row.id)
    ) {
      await this.clearResponsibleFaceFields(row);
    }

    const others = await this.database.db
      .select({
        id: responsibles.id,
        clientId: responsibles.clientId,
        photoKey: responsibles.photoKey,
        faceId: responsibles.faceId,
      })
      .from(responsibles)
      .where(eq(responsibles.userId, previousUserId));

    for (const other of others) {
      const parsed = parseBondPhotoKey(other.photoKey);
      if (parsed?.bondId !== row.id) continue;
      await this.clearResponsibleFaceFields(other);
    }
  }

  private async clearResponsibleFaceFields(row: {
    id: string;
    clientId: string;
    photoKey: string | null;
    faceId: number | null;
  }) {
    this.log.warn(
      `Face aliasada zerada após split de login: responsável ${row.id} ` +
        `faceId=${row.faceId ?? '—'}`,
    );
    const previousFaceId = row.faceId;
    await responsiblesQueries.updateResponsibleFace(
      this.database.db,
      row.id,
      row.clientId,
      {
        photoKey: null,
        faceId: null,
        deviceSyncStatus: null,
        deviceSyncedAt: null,
        deviceSyncError: null,
      },
    );
    if (previousFaceId == null) return;
    const remove = await this.personProfile.shouldRemoveFaceFromReader(
      previousFaceId,
      row.clientId,
      { responsibleId: row.id },
    );
    if (!remove) return;
    await this.faceSync.removePersonFromReaders({
      clientId: row.clientId,
      faceId: previousFaceId,
      logContext: `split-shared-login=${row.id}`,
      requireAll: false,
    });
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
    const rows =
      await responsiblesQueries.listResponsibleStudentLinksWithStudents(
        this.database.db,
        responsibleId,
        clientId,
      );
    return Promise.all(
      rows.map(async (item) => ({
        link: item.link,
        student: {
          ...item.student,
          photoUrl: await this.optionalPhotoUrl(item.student.photoKey),
        },
        schoolClass: item.schoolClass,
      })),
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

    const updated = await responsiblesQueries.updateResponsibleStudentLink(
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

  async enqueueGlobalFaceSync(user: JwtPayload, clientId: string) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    return this.faceSync.enqueueSchoolBatchJob(
      clientId,
      'responsible',
      user.sub,
    );
  }

  async getGlobalFaceSyncStatus(user: JwtPayload, clientId: string) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    return {
      clientId,
      jobs: await this.faceSync.listActiveFaceJobs(clientId),
    };
  }

  async syncFaceByCompany(
    user: JwtPayload,
    clientId: string,
    responsibleId: string,
    options?: { allowSimilarFace?: boolean },
  ): Promise<{
    deviceSyncStatus: 'synced' | 'sync_failed' | 'pending_sync';
    deviceSyncError: string | null;
    jobId?: string;
  }> {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    if (options?.allowSimilarFace === true) {
      this.faceSync.assertCanAllowSimilarFace(user);
    }
    const row = await responsiblesQueries.getResponsibleWithFaceStatus(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Responsável não encontrado.');
    }
    if (!row.photoKey || row.faceId == null) {
      throw new BadRequestException('Sem foto cadastrada para sincronizar.');
    }

    const responsible = await responsiblesQueries.getResponsibleById(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!responsible) {
      throw new NotFoundException('Responsável não encontrado.');
    }

    await responsiblesQueries.updateResponsibleFace(
      this.database.db,
      responsibleId,
      clientId,
      {
        deviceSyncStatus: 'pending_sync',
        deviceSyncedAt: null,
        deviceSyncError: null,
      },
    );

    return this.faceSync.enqueuePersonSync({
      clientId,
      entityKind: 'responsible',
      entityId: responsibleId,
      faceId: row.faceId,
      name: responsible.name,
      photoKey: row.photoKey,
      timeSectionIds: await this.accessTimeZone.resolveResponsibleTimeSections(
        clientId,
        responsibleId,
      ),
      logContext: `responsible-sync=${responsibleId}`,
      resetReaderProgress: false,
      allowSimilarFace: options?.allowSimilarFace === true,
      previousDeviceSyncError: row.deviceSyncError,
      blocked: responsible.blockedAt != null,
      persistResult: async (sync) => {
        await responsiblesQueries.updateResponsibleFace(
          this.database.db,
          responsibleId,
          clientId,
          {
            deviceSyncStatus: sync.deviceSyncStatus,
            deviceSyncedAt:
              sync.deviceSyncStatus === 'synced' ? new Date() : null,
            deviceSyncError: sync.deviceSyncError,
          },
        );
        if (responsible.userId && row.faceId != null && row.photoKey) {
          await this.personProfile.propagateFaceToSiblings(
            responsible.userId,
            clientId,
            {
              faceId: row.faceId,
              photoKey: row.photoKey,
              deviceSyncStatus: sync.deviceSyncStatus,
              deviceSyncedAt:
                sync.deviceSyncStatus === 'synced' ? new Date() : null,
              deviceSyncError: sync.deviceSyncError,
            },
            { responsibleId },
          );
        }
      },
    });
  }

  async block(
    user: JwtPayload,
    clientId: string,
    responsibleId: string,
    body: unknown,
  ) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);
    const parsed = blockPersonSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }
    const reason = parsed.data.reason;

    const existing = await responsiblesQueries.getResponsibleById(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!existing) {
      throw new NotFoundException('Responsável não encontrado.');
    }
    if (existing.blockedAt) {
      throw new BadRequestException('Responsável já está bloqueado.');
    }
    if (!existing.photoKey) {
      throw new BadRequestException(
        'Sem foto cadastrada — não é possível enviar a face ao leitor.',
      );
    }

    let faceId = existing.faceId;
    if (faceId == null) {
      faceId = await registrationsQueries.bumpClientFaceCounter(
        this.database.db,
        clientId,
      );
      await responsiblesQueries.updateResponsibleFace(
        this.database.db,
        responsibleId,
        clientId,
        { faceId },
      );
    }

    const updated = await responsiblesQueries.blockResponsible(
      this.database.db,
      responsibleId,
      clientId,
      user.sub,
      reason,
    );
    if (!updated) {
      throw new NotFoundException('Responsável não encontrado.');
    }

    await responsiblesQueries.updateResponsibleFace(
      this.database.db,
      responsibleId,
      clientId,
      {
        deviceSyncStatus: 'pending_sync',
        deviceSyncedAt: null,
        deviceSyncError: null,
      },
    );

    try {
      await this.faceSync.enqueuePersonSync({
        clientId,
        entityKind: 'responsible',
        entityId: responsibleId,
        faceId,
        name: updated.name,
        photoKey: updated.photoKey ?? existing.photoKey,
        timeSectionIds: [],
        logContext: `responsible-block=${responsibleId}`,
        resetReaderProgress: true,
        blocked: true,
        persistResult: async (sync) => {
          await responsiblesQueries.updateResponsibleFace(
            this.database.db,
            responsibleId,
            clientId,
            {
              deviceSyncStatus: sync.deviceSyncStatus,
              deviceSyncedAt:
                sync.deviceSyncStatus === 'synced' ? new Date() : null,
              deviceSyncError: sync.deviceSyncError,
            },
          );
        },
      });
    } catch (err: unknown) {
      this.log.warn(
        `enqueue pós-bloqueio responsible=${responsibleId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return {
      ...updated,
      email: updated.userId
        ? await responsiblesQueries.getResponsibleEmailByUserId(
            this.database.db,
            updated.userId,
          )
        : null,
      photoUrl: await this.optionalPhotoUrl(updated.photoKey),
    };
  }

  async unblock(user: JwtPayload, clientId: string, responsibleId: string) {
    await this.schoolAccess.assertManageSchoolClient(user, clientId);

    const existing = await responsiblesQueries.getResponsibleById(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!existing) {
      throw new NotFoundException('Responsável não encontrado.');
    }
    if (!existing.blockedAt) {
      throw new BadRequestException('Responsável não está bloqueado.');
    }

    const updated = await responsiblesQueries.unblockResponsible(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!updated) {
      throw new NotFoundException('Responsável não encontrado.');
    }

    const photoKey = updated.photoKey ?? existing.photoKey;
    let faceId = updated.faceId ?? existing.faceId;
    if (photoKey && faceId == null) {
      faceId = await registrationsQueries.bumpClientFaceCounter(
        this.database.db,
        clientId,
      );
      await responsiblesQueries.updateResponsibleFace(
        this.database.db,
        responsibleId,
        clientId,
        { faceId },
      );
    }

    if (photoKey && faceId != null) {
      await responsiblesQueries.updateResponsibleFace(
        this.database.db,
        responsibleId,
        clientId,
        {
          deviceSyncStatus: 'pending_sync',
          deviceSyncedAt: null,
          deviceSyncError: null,
        },
      );

      try {
        await this.faceSync.enqueuePersonSync({
          clientId,
          entityKind: 'responsible',
          entityId: responsibleId,
          faceId,
          name: updated.name,
          photoKey,
          timeSectionIds:
            await this.accessTimeZone.resolveResponsibleTimeSections(
              clientId,
              responsibleId,
            ),
          logContext: `responsible-unblock=${responsibleId}`,
          resetReaderProgress: true,
          blocked: false,
          persistResult: async (sync) => {
            await responsiblesQueries.updateResponsibleFace(
              this.database.db,
              responsibleId,
              clientId,
              {
                deviceSyncStatus: sync.deviceSyncStatus,
                deviceSyncedAt:
                  sync.deviceSyncStatus === 'synced' ? new Date() : null,
                deviceSyncError: sync.deviceSyncError,
              },
            );
          },
        });
      } catch (err: unknown) {
        this.log.warn(
          `enqueue pós-desbloqueio responsible=${responsibleId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return {
      ...updated,
      email: updated.userId
        ? await responsiblesQueries.getResponsibleEmailByUserId(
            this.database.db,
            updated.userId,
          )
        : null,
      photoUrl: await this.optionalPhotoUrl(updated.photoKey),
    };
  }

  async delete(
    user: JwtPayload,
    clientId: string,
    responsibleId: string,
  ): Promise<{ removed: true; id: string }> {
    if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }

    await this.schoolAccess.assertManageSchoolClient(user, clientId);

    const target = await responsiblesQueries.getResponsibleById(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!target) {
      throw new NotFoundException('Responsável não encontrado.');
    }

    const targetVehicles = await vehicleQueries.vehicleListByResponsible(
      this.database.db,
      target.id,
      clientId,
    );

    const faceId = target.faceId;
    const logContext = `delete-responsible=${target.id}`;

    if (faceId != null) {
      const removeFromReader =
        await this.personProfile.shouldRemoveFaceFromReader(faceId, clientId, {
          responsibleId: target.id,
        });
      if (removeFromReader) {
        await this.faceSync.removePersonFromReaders({
          clientId,
          faceId,
          logContext,
          requireAll: true,
        });
      }
    }

    for (const vehicle of targetVehicles) {
      await this.lprPlateSync.removePlateFromAllLprCameras(
        clientId,
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
        clientId,
      );
      await responsiblesQueries.updateResponsible(tx, target.id, clientId, {
        isActive: false,
        pushToken: null,
        faceId: null,
        photoKey: null,
        deviceSyncStatus: null,
        deviceSyncedAt: null,
        deviceSyncError: null,
      });
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

    return { removed: true, id: target.id };
  }
}
