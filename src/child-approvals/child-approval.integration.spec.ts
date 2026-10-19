import { VisitorApprovalRepository } from '../visitor-approvals/visitor-approval.repository';
import { VisitorApprovalPolicyService } from '../visitor-approvals/visitor-approval-policy.service';
import { VisitorApprovalRevocationService } from '../visitor-approvals/visitor-approval-revocation.service';
import { VisitorApprovalInvitationService } from '../visitor-approvals/visitor-approval-invitation.service';
import { VisitorApprovalDeliveryRepository } from '../visitor-approvals/visitor-approval-delivery.repository';
import { VisitorApprovalDeliveryService } from '../visitor-approvals/visitor-approval-delivery.service';
import { VisitorApprovalPublicService } from '../visitor-approvals/visitor-approval-public.service';
import { VisitorApprovalService } from '../visitor-approvals/visitor-approval.service';
import { VisitorApprovalRegistrationListener } from '../registrations/visitor-approval-registration.listener';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { execFileSync } from 'node:child_process';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as schema from '../database/schema';
import type { DatabaseService } from '../database/database.service';
import type { EmailService } from '../email/email.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { RegistrationEventsRepository } from '../database/repositories/registration-events.repository';
import { RegistrationEventsService } from '../registrations/registration-events.service';
import { RegistrationsAdminService } from '../registrations/registrations-admin.service';
import { PublicRegistrationService } from '../registrations/public-registration.service';
import { ClientBlocksRepository } from '../client-blocks/client-blocks.repository';
import type { R2StorageService } from '../storage/r2-storage.service';
import { ChildApprovalRegistrationListener } from '../registrations/child-approval-registration.listener';
import { ChildApprovalRemovalService } from '../face-sync/child-approval-removal.service';
import { ChildApprovalRepository } from './child-approval.repository';
import { ChildApprovalPolicyService } from './child-approval-policy.service';
import { ChildApprovalInvitationService } from './child-approval-invitation.service';
import { ChildApprovalDeliveryRepository } from './child-approval-delivery.repository';
import { ChildApprovalDeliveryService } from './child-approval-delivery.service';
import { ChildApprovalPublicService } from './child-approval-public.service';
import { ChildApprovalService } from './child-approval.service';
import { ChildApprovalRevocationService } from './child-approval-revocation.service';
import { ChildApprovalMaintenanceService } from './child-approval-maintenance.service';
import { DeviceSyncQueueService } from '../device-sync-queue/device-sync-queue.service';
import { DeviceSyncWorkerService } from '../device-sync-queue/device-sync-worker.service';
import type { FaceSyncService } from '../face-sync/face-sync.service';
import { DeviceSyncJobHandlersService } from '../device-sync-queue/device-sync-job-handlers.service';
import {
  CHILD_APPROVAL_ACCEPTED,
  CHILD_APPROVAL_CHANGED,
} from './child-approval.util';

// Opt-in; exclusively the disposable instance started for this test, never .env.
const run =
  process.env.CHILD_APPROVAL_TEST_SOCKET === '/tmp' ? describe : describe.skip;
run('Child approvals — PostgreSQL transactions and migration', () => {
  const connection = { host: '/tmp', port: 65431, user: 'child_test' };
  const adminPool = new Pool({ ...connection, database: 'postgres' });
  const pool = new Pool({
    ...connection,
    database: 'face2go_child_approval_test',
    max: 10,
  });
  const db = drizzle(pool, { schema });
  const database = { db } as DatabaseService;
  const repository = new ChildApprovalRepository(database);
  const visitorRepository = new VisitorApprovalRepository(database);
  const visitorPolicy = new VisitorApprovalPolicyService(visitorRepository);
  const visitorRevocations = new VisitorApprovalRevocationService(
    visitorRepository,
  );
  const policy = new ChildApprovalPolicyService(
    repository,
    visitorPolicy,
    visitorRepository,
  );
  const revocations = new ChildApprovalRevocationService(repository);
  const key = '0123456789abcdef'.repeat(4);
  const config = new ConfigService({
    READER_ENCRYPTION_KEY: key,
  });
  const visitorEmails: { to: string; token: string }[] = [];
  const emails: { to: string; token: string }[] = [];
  const registrationApprovedEmail = jest.fn();
  const email = {
    sendChildApprovalRequestEmail: jest.fn(
      (input: { to: string; token: string }) => {
        emails.push(input);
        return Promise.resolve();
      },
    ),
    sendVisitorApprovalRequestEmail: jest.fn(
      (input: { to: string; token: string }) => {
        visitorEmails.push(input);
        return Promise.resolve();
      },
    ),
    sendRegistrationApprovedEmail: registrationApprovedEmail,
  } as unknown as EmailService;
  const delivery = new ChildApprovalDeliveryService(
    new ChildApprovalDeliveryRepository(database),
    repository,
    email,
    config,
  );
  const invitations = new ChildApprovalInvitationService(
    repository,
    config,
    delivery,
  );
  const events = new EventEmitter2();
  const publicApproval = new ChildApprovalPublicService(
    repository,
    invitations,
    events,
    revocations,
  );
  const approvals = new ChildApprovalService(
    repository,
    policy,
    events,
    {} as never,
    invitations,
    publicApproval,
    revocations,
  );
  const visitorDelivery = new VisitorApprovalDeliveryService(
    new VisitorApprovalDeliveryRepository(database),
    visitorRepository,
    email,
    config,
  );
  const visitorInvitations = new VisitorApprovalInvitationService(
    visitorRepository,
    config,
    visitorDelivery,
  );
  const visitorPublic = new VisitorApprovalPublicService(
    visitorRepository,
    visitorInvitations,
    events,
    visitorRevocations,
  );
  const visitorApprovals = new VisitorApprovalService(
    visitorRepository,
    visitorPolicy,
    events,
    {} as never,
    visitorInvitations,
    visitorPublic,
    visitorRevocations,
  );
  const faceSync = {
    enqueueApprovedRegistrationJob: jest.fn(),
    removePersonFromReaders: jest
      .fn()
      .mockResolvedValue({ removed: 0, total: 0 }),
    hasActiveFacialReaders: jest.fn().mockResolvedValue(false),
    getReaderSyncCounts: jest
      .fn()
      .mockResolvedValue({ total: 0, syncedByFace: new Map() }),
  };
  const queue = { enqueue: jest.fn(), update: jest.fn() };
  const removal = new ChildApprovalRemovalService(
    repository,
    policy,
    queue as never,
    faceSync as never,
    visitorRepository,
  );
  const removalWorker = (durableQueue: DeviceSyncQueueService) =>
    new DeviceSyncWorkerService(
      durableQueue,
      new DeviceSyncJobHandlersService(
        durableQueue,
        faceSync as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        database,
        removal,
      ),
    );
  const admin = new RegistrationsAdminService(
    database,
    {} as never,
    {} as never,
    faceSync as never,
    {
      getByRegistrationId: jest.fn().mockResolvedValue(null),
      upsertFromApprovedRegistration: jest.fn(
        async (r: typeof schema.registrations.$inferSelect) =>
          db
            .update(schema.clientMembers)
            .set({ faceId: r.faceId, isActive: true })
            .where(eq(schema.clientMembers.registrationId, r.id)),
      ),
    } as never,
    {} as never,
    new RegistrationEventsService(new RegistrationEventsRepository(database)),
    email,
    {} as never,
    approvals,
    policy,
    repository,
    visitorApprovals,
    visitorPolicy,
    visitorRepository,
  );
  const listener = new ChildApprovalRegistrationListener(
    admin,
    repository,
    policy,
    removal,
    faceSync as never,
  );
  const visitorListener = new VisitorApprovalRegistrationListener(
    admin,
    visitorRepository,
    policy,
    removal,
    faceSync as never,
  );
  let clientId: string,
    childId: string,
    adult1Id: string,
    adult2Id: string,
    unitId: string,
    unit2Id: string,
    userId: string;
  const cpf1 = '52998224725',
    cpf2 = '11144477735';
  const actor = (): JwtPayload => ({
    sub: userId,
    email: 'admin@example.test',
    role: 'client_admin',
    contextType: 'client',
    clientId,
  });
  const token = (email: string) =>
    [...emails].reverse().find((e) => e.to === email)!.token;
  const accept = async (email = 'adult1@example.test', cpf = cpf1) => {
    const t = token(email);
    const preview = await approvals.preview(t);
    return approvals.accept(t, {
      cpf,
      agreed: true,
      termVersion: preview.termVersion,
    });
  };
  beforeAll(async () => {
    await adminPool.query('CREATE DATABASE face2go_child_approval_test');
    const statements = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          join(__dirname, '../../scripts/child-approval-test-baseline.ts'),
        ],
        { encoding: 'utf8' },
      ),
    ) as string[];
    for (const statement of statements) await pool.query(statement);
    await pool.query(
      readFileSync(
        join(__dirname, '../../drizzle/0090_child_approvals.sql'),
        'utf8',
      ),
    );
    await pool.query(
      readFileSync(
        join(__dirname, '../../drizzle/0093_visitor_approvals.sql'),
        'utf8',
      ),
    );
    // EventEmitter2's on() types declare void; emitAsync awaits promises.
    const onAsync = events.on.bind(events) as unknown as (
      event: string,
      listener: (change: {
        clientId: string;
        registrationId: string;
      }) => Promise<void>,
    ) => void;
    onAsync('visitor-approval.accepted', (change) =>
      visitorListener.accepted(change),
    );
    onAsync('visitor-approval.changed', (change) =>
      visitorListener.changed(change),
    );
    onAsync(
      CHILD_APPROVAL_ACCEPTED,
      (change: { clientId: string; registrationId: string }) =>
        listener.accepted(change),
    );

    onAsync(
      CHILD_APPROVAL_CHANGED,
      (change: { clientId: string; registrationId: string }) =>
        listener.changed(change),
    );
  }, 30000);
  afterAll(async () => {
    await pool.end();
    await adminPool.query(
      'DROP DATABASE IF EXISTS face2go_child_approval_test',
    );
    await adminPool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE companies, "user" CASCADE');
    emails.length = 0;
    visitorEmails.length = 0;
    jest.clearAllMocks();
    queue.enqueue.mockReset();
    queue.update.mockReset();
    faceSync.removePersonFromReaders
      .mockReset()
      .mockResolvedValue({ removed: 0, total: 0 });
    userId = randomUUID();
    clientId = randomUUID();
    childId = randomUUID();
    adult1Id = randomUUID();
    adult2Id = randomUUID();
    unitId = randomUUID();
    unit2Id = randomUUID();
    const companyId = randomUUID(),
      blockId = randomUUID(),
      linkId = randomUUID(),
      roleId = randomUUID();
    await db
      .insert(schema.users)
      .values({ id: userId, email: 'admin@example.test' });
    await db
      .insert(schema.companies)
      .values({ id: companyId, name: 'Empresa teste' });
    await db.insert(schema.clients).values({
      id: clientId,
      companyId,
      name: 'Mercado teste',
      type: 'condominium',
      enableChildApprove: true,
      timezoneOffsetMinutes: -240,
    });
    await db
      .insert(schema.clientBlocks)
      .values({ id: blockId, clientId, name: 'A' });
    await db.insert(schema.clientUnits).values([
      { id: unitId, clientId, blockId, name: '101' },
      { id: unit2Id, clientId, blockId, name: '102' },
    ]);
    await db.insert(schema.registrationLinks).values({
      id: linkId,
      clientId,
      createdByUserId: userId,
      code: randomUUID().toUpperCase(),
    });
    await db.insert(schema.registrations).values([
      {
        id: childId,
        clientId,
        registrationLinkId: linkId,
        unitId,
        name: 'Menor teste',
        birthDate: '2012-01-01',
        childApprovalRequired: true,
        status: 'draft',
        faceId: 52,
        faceImageKey: 'test.jpg',
        submittedAt: new Date(),
        additionalData: { block: 'A', unit: '101' },
      },
      {
        id: adult1Id,
        clientId,
        registrationLinkId: linkId,
        unitId,
        name: 'Adulto 1',
        birthDate: '1990-01-01',
        document: cpf1,
        email: 'adult1@example.test',
        status: 'approved',
      },
      {
        id: adult2Id,
        clientId,
        registrationLinkId: linkId,
        unitId,
        name: 'Adulto 2',
        birthDate: '1991-01-01',
        document: cpf2,
        email: 'adult2@example.test',
        status: 'approved',
      },
      {
        id: randomUUID(),
        clientId,
        registrationLinkId: linkId,
        unitId: unit2Id,
        name: 'Outra unidade',
        birthDate: '1980-01-01',
        document: '12345678909',
        email: 'other@example.test',
        status: 'approved',
      },
    ]);
    await db
      .insert(schema.clientRoles)
      .values({ id: roleId, clientId, name: 'Morador', slug: 'resident' });
    await db.insert(schema.clientMembers).values({
      clientId,
      roleId,
      registrationId: childId,
      name: 'Menor duplicado',
      faceId: 53,
      unitId,
    });
    await invitations.requestEmails(clientId, childId);
  });

  it('envia só aos adultos aprovados da mesma unidade e não expõe o CPF', async () => {
    expect(emails.map((e) => e.to).sort()).toEqual([
      'adult1@example.test',
      'adult2@example.test',
    ]);
    expect(
      JSON.stringify(await approvals.preview(token('adult1@example.test'))),
    ).not.toContain(cpf1);
    expect(await policy.faceAllowed(clientId, 52)).toBe(false);
    expect(await policy.faceAllowed(clientId, 53)).toBe(false);
  });
  it.each([false, true])(
    'cadastro público com autoaprovação respeita enableChildApprove=%s',
    async (enabled) => {
      await db
        .update(schema.clients)
        .set({ autoApproveRegistrations: true, enableChildApprove: enabled })
        .where(eq(schema.clients.id, clientId));
      const client = await repository.client(clientId);
      const [link] = await db
        .select()
        .from(schema.registrationLinks)
        .where(eq(schema.registrationLinks.clientId, clientId));
      const registrationId = randomUUID();
      const registration = new PublicRegistrationService(
        database,
        {
          assertObjectExists: jest.fn().mockResolvedValue(undefined),
        } as unknown as R2StorageService,
        new ClientBlocksRepository(database),
        admin,
        approvals,
      );
      emails.length = 0;
      visitorEmails.length = 0;

      await registration.submit(link.code, {
        registrationId,
        name: 'Ana Luiza teste',
        document: '39053344705',
        phone: '65999998888',
        email: 'minor@example.test',
        birthDate: '2014-01-13',
        unitId,
        faceImageKey: `${client.companyId}/${clientId}/${registrationId}/face.jpg`,
        truthDeclared: true,
      });

      const saved = await repository.registration(clientId, registrationId);
      expect(saved.childApprovalRequired).toBe(enabled);
      expect(saved.status).toBe(enabled ? 'draft' : 'approved');
      expect(saved.childApprovalRequestedAt !== null).toBe(enabled);
      expect(faceSync.enqueueApprovedRegistrationJob).toHaveBeenCalledTimes(
        enabled ? 0 : 1,
      );
      expect(emails.map((e) => e.to).sort()).toEqual(
        enabled ? ['adult1@example.test', 'adult2@example.test'] : [],
      );

      if (enabled) {
        await accept();
        expect(
          (await repository.registration(clientId, registrationId))?.status,
        ).toBe('approved');
        expect(faceSync.enqueueApprovedRegistrationJob).toHaveBeenCalledTimes(
          1,
        );
      }
    },
  );
  it('aprova automaticamente depois do aceite e preserva o faceId na reaprovação', async () => {
    await repository.patchRegistration(clientId, childId, {
      status: 'rejected',
    });
    await admin.approveAutomatically(clientId, childId);
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'rejected',
    );
    await accept();
    const child = await repository.registration(clientId, childId);
    expect(child?.status).toBe('approved');
    expect(child?.faceId).toBe(52);
    expect(child?.childApprovalRequestedAt).toBeNull();
    expect(faceSync.enqueueApprovedRegistrationJob).toHaveBeenCalledTimes(1);
    expect(await policy.faceAllowed(clientId, 53)).toBe(true);
  });
  it('aceite anterior à decisão não aprova sozinho; replay não duplica histórico', async () => {
    await Promise.all([accept(), accept()]);
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'draft',
    );
    expect(await repository.activeConsentCount(clientId, childId)).toBe(1);
    expect(await repository.history(clientId, childId)).toHaveLength(1);
  });
  it('mantém outro aceite válido e bloqueia depois da última revogação', async () => {
    await admin.approveAutomatically(clientId, childId);
    await Promise.all([accept(), accept('adult2@example.test', cpf2)]);
    expect(await repository.activeConsentCount(clientId, childId)).toBe(2);
    await approvals.revokeOwn(token('adult1@example.test'), cpf1);
    expect(await policy.faceAllowed(clientId, 52)).toBe(true);
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'approved',
    );
    expect(
      (await repository.registration(clientId, childId))
        ?.childApprovalRemovalPending,
    ).toBe(false);
    expect(queue.enqueue).not.toHaveBeenCalled();
    const consent = (await repository.history(clientId, childId)).find(
      (c) => !c.revokedAt,
    )!;
    await approvals.revokeAdmin(
      actor(),
      clientId,
      consent.id,
      'Solicitação da administração.',
      childId,
    );
    expect(await policy.faceAllowed(clientId, 52)).toBe(false);
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'rejected',
    );
    expect((await db.select().from(schema.clientMembers))[0].isActive).toBe(
      false,
    );
    await removal.run({
      id: randomUUID(),
      clientId,
      targetId: childId,
    } as never);
    expect(await policy.faceAllowed(clientId, 53)).toBe(false);
    expect(faceSync.removePersonFromReaders).toHaveBeenCalledTimes(2);
    expect(await repository.history(clientId, childId)).toHaveLength(2);
  });
  it('recupera a remoção quando o processo para depois do commit e antes de enfileirar', async () => {
    await admin.approveAutomatically(clientId, childId);
    await accept();
    const durableQueue = new DeviceSyncQueueService(database);
    queue.enqueue.mockRejectedValueOnce(new Error('Processo interrompido'));
    await approvals.revokeOwn(token('adult1@example.test'), cpf1);
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'rejected',
    );
    expect(
      (await repository.registration(clientId, childId))
        ?.childApprovalRemovalPending,
    ).toBe(true);
    expect(await durableQueue.listByIds([])).toEqual([]);
    expect(
      (await pool.query('SELECT * FROM device_sync_jobs')).rows,
    ).toHaveLength(0);
    queue.enqueue.mockImplementation(
      (input: Parameters<DeviceSyncQueueService['enqueue']>[0]) =>
        durableQueue.enqueue(input),
    );
    queue.update.mockImplementation(
      (id: string, patch: Parameters<DeviceSyncQueueService['update']>[1]) =>
        durableQueue.update(id, patch),
    );
    const maintenance = new ChildApprovalMaintenanceService(
      repository,
      approvals,
      delivery,
      revocations,
    );
    await maintenance.tick();
    const abandoned = (await durableQueue.claimNext('worker-before-crash'))!;
    expect(abandoned.kind).toBe('face.remove');
    await pool.query(
      "UPDATE device_sync_jobs SET heartbeat_at = now() - interval '3 minutes' WHERE id = $1",
      [abandoned.id],
    );
    expect(await durableQueue.recoverRunning({ staleSeconds: 120 }, 3)).toEqual(
      [{ id: abandoned.id, status: 'queued' }],
    );
    const recovered = (await durableQueue.claimNext('worker-after-restart'))!;
    const worker = removalWorker(durableQueue);
    // runJob finaliza somente leases pertencentes a esta instância.
    await pool.query(
      'UPDATE device_sync_jobs SET locked_by = $1 WHERE id = $2',
      [worker.workerId, recovered.id],
    );
    await worker.runJob(recovered);
    expect((await durableQueue.getById(recovered.id))?.status).toBe('done');
    expect(
      (await repository.registration(clientId, childId))
        ?.childApprovalRemovalPending,
    ).toBe(false);
    expect(faceSync.removePersonFromReaders).toHaveBeenCalledTimes(2);
  });
  it('mantém a pendência após falha parcial e só limpa sincronização quando todos os leitores removem', async () => {
    await admin.approveAutomatically(clientId, childId);
    await accept();
    await repository.patchRegistration(clientId, childId, {
      deviceSyncStatus: 'synced',
      deviceSyncedAt: new Date(),
    });
    await db
      .update(schema.clientMembers)
      .set({ deviceSyncStatus: 'synced', deviceSyncedAt: new Date() });
    const durableQueue = new DeviceSyncQueueService(database);
    queue.enqueue.mockImplementation(
      (input: Parameters<DeviceSyncQueueService['enqueue']>[0]) =>
        durableQueue.enqueue(input),
    );
    queue.update.mockImplementation(
      (id: string, patch: Parameters<DeviceSyncQueueService['update']>[1]) =>
        durableQueue.update(id, patch),
    );
    const readers = new Map([
      [52, new Set(['reader-1', 'reader-2'])],
      [53, new Set(['reader-1', 'reader-2'])],
    ]);
    let fail = true;
    const readerCount = jest
      .spyOn(repository, 'activeReaderCount')
      .mockResolvedValue(2);
    faceSync.removePersonFromReaders.mockImplementation(
      ({
        faceId,
      }: Parameters<FaceSyncService['removePersonFromReaders']>[0]) => {
        readers.get(faceId)!.delete('reader-1');
        if (fail) return Promise.reject(new Error('Leitor 2 indisponível'));
        readers.get(faceId)!.delete('reader-2');
        return Promise.resolve({ removed: 2, total: 2 });
      },
    );
    try {
      await approvals.revokeOwn(token('adult1@example.test'), cpf1);
      const worker = removalWorker(durableQueue);
      const first = (await durableQueue.claimNext(worker.workerId))!;
      await worker.runJob(first);
      expect((await durableQueue.getById(first.id))?.status).toBe('failed');
      const failed = await repository.registration(clientId, childId);
      expect(failed.status).toBe('rejected');
      expect(failed.childApprovalRemovalPending).toBe(true);
      expect(failed.deviceSyncStatus).toBe('synced');
      expect(readers.get(52)!.size).toBe(1);
      fail = false;
      const maintenance = new ChildApprovalMaintenanceService(
        repository,
        approvals,
        delivery,
        revocations,
      );
      await maintenance.tick();
      const retry = (await durableQueue.claimNext(worker.workerId))!;
      await worker.runJob(retry);
      expect((await durableQueue.getById(retry.id))?.status).toBe('done');
      const removed = await repository.registration(clientId, childId);
      expect(removed.childApprovalRemovalPending).toBe(false);
      expect(removed.deviceSyncStatus).toBeNull();
      expect(removed.deviceSyncedAt).toBeNull();
      expect(
        (await db.select().from(schema.clientMembers))[0].deviceSyncStatus,
      ).toBeNull();
      expect([...readers.values()].every((faces) => faces.size === 0)).toBe(
        true,
      );
      expect(faceSync.removePersonFromReaders).toHaveBeenCalledWith(
        expect.objectContaining({ requireAll: true }),
      );
      await maintenance.tick();
      expect(await durableQueue.claimNext(worker.workerId)).toBeNull();
    } finally {
      readerCount.mockRestore();
    }
  });
  it('um novo aceite após revogação exige reaprovação iniciada e preserva o histórico', async () => {
    await admin.approveAutomatically(clientId, childId);
    await accept();
    await approvals.revokeOwn(token('adult1@example.test'), cpf1);
    await admin.approveAutomatically(clientId, childId);
    expect(
      (await repository.registration(clientId, childId))
        ?.childApprovalRequestedAt,
    ).not.toBeNull();
    await new ChildApprovalMaintenanceService(
      repository,
      approvals,
      delivery,
      revocations,
    ).tick();
    expect(
      (await repository.registration(clientId, childId))
        ?.childApprovalRequestedAt,
    ).not.toBeNull();
    await accept();
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'approved',
    );
    expect(
      (await repository.history(clientId, childId)).filter((c) => c.revokedAt),
    ).toHaveLength(1);
    expect(await repository.activeConsentCount(clientId, childId)).toBe(1);
  });
  it('continua reconciliando a remoção mesmo se o cadastro e o cliente forem desativados', async () => {
    await admin.approveAutomatically(clientId, childId);
    await accept();
    await approvals.revokeOwn(token('adult1@example.test'), cpf1);
    await repository.patchRegistration(clientId, childId, { isActive: false });
    await db
      .update(schema.clients)
      .set({ isActive: false })
      .where(eq(schema.clients.id, clientId));
    expect(
      (await repository.pendingCases()).map((c) => c.registration.id),
    ).toContain(childId);
    await new ChildApprovalMaintenanceService(
      repository,
      approvals,
      delivery,
      revocations,
    ).tick();
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'face.remove', targetId: childId }),
    );
  });
  it('CPF incorreto persiste tentativas e trava após cinco erros', async () => {
    for (let i = 0; i < 5; i++)
      await expect(accept('adult1@example.test', cpf2)).rejects.toThrow('CPF');
    await expect(accept()).rejects.toThrow('15 minutos');
    const request = (await repository.requests(clientId, childId)).find(
      (r) => r.adultRegistrationId === adult1Id,
    )!;
    expect(request.verificationFailures).toBe(5);
    expect(request.lockedUntil).not.toBeNull();
    expect(await repository.activeConsentCount(clientId, childId)).toBe(0);
  });
  it.each(['adult', 'child'])(
    'mudança de unidade do %s invalida permanentemente, mesmo voltando',
    async (who) => {
      await admin.approveAutomatically(clientId, childId);
      await accept();
      const id = who === 'adult' ? adult1Id : childId;
      await db
        .update(schema.registrations)
        .set({ unitId: unit2Id })
        .where(eq(schema.registrations.id, id));
      expect(await policy.faceAllowed(clientId, 52)).toBe(false);
      await db
        .update(schema.registrations)
        .set({ unitId })
        .where(eq(schema.registrations.id, id));
      expect(await policy.faceAllowed(clientId, 52)).toBe(false);
      expect(
        (await repository.history(clientId, childId))[0].revocationReason,
      ).toContain('Unidade');
      expect(
        (await repository.registration(clientId, childId))
          ?.childApprovalRemovalPending,
      ).toBe(true);
    },
  );
  it('flag desligada e legado não selecionado preservam o fluxo existente', async () => {
    await repository.patchRegistration(clientId, childId, {
      status: 'approved',
      childApprovalRequired: false,
    });
    expect(await policy.faceAllowed(clientId, 52)).toBe(true);
    await approvals.regularize(actor(), clientId, childId);
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'rejected',
    );
    expect(await policy.faceAllowed(clientId, 52)).toBe(false);
    await db
      .update(schema.clients)
      .set({ enableChildApprove: false })
      .where(eq(schema.clients.id, clientId));
    // Desativar a exigência não desfaz a rejeição nem a retirada já solicitada.
    expect(await policy.faceAllowed(clientId, 52)).toBe(false);
  });
  it('escopo de cliente, papel e cadastro no caminho impedem revogação indevida', async () => {
    await accept();
    const consent = (await repository.history(clientId, childId))[0];
    await expect(
      approvals.history(
        { ...actor(), clientId: randomUUID() },
        clientId,
        childId,
      ),
    ).rejects.toThrow('permissão');
    await expect(
      approvals.revokeAdmin(
        { ...actor(), role: 'client_operator' },
        clientId,
        consent.id,
        'Teste',
        childId,
      ),
    ).rejects.toThrow('admin');
    await expect(
      approvals.revokeAdmin(actor(), clientId, consent.id, 'Teste', adult1Id),
    ).rejects.toThrow('encontrado');
  });
  it('revogação aguarda a escrita em curso; nenhuma nova escrita entra depois', async () => {
    await admin.approveAutomatically(clientId, childId);
    await accept();
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const write = policy.withFaceAccess(clientId, 52, async () => {
      entered();
      await hold;
    });
    await ready;
    const revoke = approvals.revokeOwn(token('adult1@example.test'), cpf1);
    release();
    await write;
    await revoke;
    const hardware = jest.fn();
    await expect(policy.withFaceAccess(clientId, 52, hardware)).rejects.toThrow(
      'Aguardando',
    );
    expect(hardware).not.toHaveBeenCalled();
  });
  async function configureVisitor(minor = false) {
    await db
      .update(schema.clients)
      .set({ enableVisitorApprove: true })
      .where(eq(schema.clients.id, clientId));
    await db
      .update(schema.registrations)
      .set({
        isVisitor: true,
        visitorApprovalRequired: true,
        childApprovalRequired: minor,
        email: 'visitor@example.test',
        birthDate: minor ? '2012-01-01' : '1990-01-01',
      })
      .where(eq(schema.registrations.id, childId));
    await visitorApprovals.requestEmails(clientId, childId);
  }
  async function acceptVisitor(address = 'adult1@example.test', cpf = cpf1) {
    const token = [...visitorEmails]
      .reverse()
      .find((e) => e.to === address)!.token;
    return visitorApprovals.accept(token, {
      cpf,
      agreed: true,
      termVersion: (await visitorApprovals.preview(token)).termVersion,
    });
  }
  it('visitante adulto espera aceite, conclui autoaprovação e preserva faceId', async () => {
    await configureVisitor();
    await admin.approveAutomatically(clientId, childId);
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'draft',
    );
    await acceptVisitor();
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'approved',
    );
    expect((await repository.registration(clientId, childId))?.faceId).toBe(52);
    expect(await policy.faceAllowed(clientId, 52)).toBe(true);
  });
  it('visitante menor precisa dos dois aceites, em qualquer ordem', async () => {
    await configureVisitor(true);
    await admin.approveAutomatically(clientId, childId);
    await acceptVisitor();
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'draft',
    );
    expect(await policy.faceAllowed(clientId, 52)).toBe(false);
    await accept();
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'approved',
    );
    expect(await policy.faceAllowed(clientId, 52)).toBe(true);
  });
  it('aceite de menor sozinho não aprova visitante pendente', async () => {
    await configureVisitor(true);
    await admin.approveAutomatically(clientId, childId);
    await accept();
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'draft',
    );
    await acceptVisitor();
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'approved',
    );
  });
  it('aceite de visitante anterior à análise não aprova cadastro sozinho', async () => {
    await configureVisitor();
    await acceptVisitor();
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'draft',
    );
    expect(
      (await visitorPolicy.summary(clientId, childId)).visitorApprovalStatus,
    ).toBe('authorized');
  });
  it('visitante não confirma com CPF de outro adulto e POST repetido é idempotente', async () => {
    await configureVisitor();
    await expect(acceptVisitor('adult1@example.test', cpf2)).rejects.toThrow(
      'CPF',
    );
    await acceptVisitor();
    await acceptVisitor();
    expect(await visitorRepository.history(clientId, childId)).toHaveLength(1);
  });
  it('dois adultos visitantes aceitam simultaneamente sem duplicar aprovação', async () => {
    await configureVisitor();
    await admin.approveAutomatically(clientId, childId);
    await Promise.all([
      acceptVisitor(),
      acceptVisitor('adult2@example.test', cpf2),
    ]);
    expect(await visitorRepository.activeConsentCount(clientId, childId)).toBe(
      2,
    );
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'approved',
    );
    expect(registrationApprovedEmail).toHaveBeenCalledTimes(1);
  });
  it('última revogação de visitante remove de forma durável usando handler comum', async () => {
    await configureVisitor();
    await admin.approveAutomatically(clientId, childId);
    await acceptVisitor();
    await acceptVisitor('adult2@example.test', cpf2);
    const t1 = visitorEmails.find((e) => e.to === 'adult1@example.test')!.token;
    const t2 = visitorEmails.find((e) => e.to === 'adult2@example.test')!.token;
    await visitorApprovals.revokeOwn(t1, cpf1);
    expect(await policy.faceAllowed(clientId, 52)).toBe(true);
    await visitorApprovals.revokeOwn(t2, cpf2);
    const row = await repository.registration(clientId, childId);
    expect(row?.status).toBe('rejected');
    expect(row?.visitorApprovalRemovalPending).toBe(true);
    expect(await policy.faceAllowed(clientId, 52)).toBe(false);
    await removal.run({
      id: randomUUID(),
      clientId,
      targetId: childId,
    } as never);
    expect(faceSync.removePersonFromReaders).toHaveBeenCalled();
    expect(
      (await repository.registration(clientId, childId))
        ?.visitorApprovalRemovalPending,
    ).toBe(false);
  });
  it('mudar unidade e voltar não reativa autorização de visitante', async () => {
    await configureVisitor();
    await acceptVisitor();
    await db
      .update(schema.registrations)
      .set({ unitId: unit2Id })
      .where(eq(schema.registrations.id, adult1Id));
    await db
      .update(schema.registrations)
      .set({ unitId })
      .where(eq(schema.registrations.id, adult1Id));
    expect(await visitorRepository.activeConsentCount(clientId, childId)).toBe(
      0,
    );
    expect(
      (await visitorRepository.history(clientId, childId))[0].revokedAt,
    ).not.toBeNull();
  });
  it('converter adulto em visitante invalida aceites de menores e visitantes permanentemente', async () => {
    await configureVisitor(true);
    await admin.approveAutomatically(clientId, childId);
    await accept();
    await acceptVisitor();
    await db
      .update(schema.registrations)
      .set({ isVisitor: true })
      .where(eq(schema.registrations.id, adult1Id));
    expect(await visitorRepository.activeConsentCount(clientId, childId)).toBe(
      0,
    );
    expect(await repository.activeConsentCount(clientId, childId)).toBe(0);
    await db
      .update(schema.registrations)
      .set({ isVisitor: false })
      .where(eq(schema.registrations.id, adult1Id));
    expect(await repository.activeConsentCount(clientId, childId)).toBe(0);
    expect(await visitorRepository.activeConsentCount(clientId, childId)).toBe(
      0,
    );
  });
  it('não envia solicitação a outro visitante nem aceita link após bloqueio do adulto', async () => {
    await db
      .update(schema.registrations)
      .set({ isVisitor: true })
      .where(eq(schema.registrations.id, adult2Id));
    await configureVisitor();
    expect(visitorEmails.map((e) => e.to)).toEqual(['adult1@example.test']);
    await db
      .update(schema.registrations)
      .set({ status: 'blocked' })
      .where(eq(schema.registrations.id, adult1Id));
    await expect(acceptVisitor()).rejects.toThrow();
  });
  it('regularização converte cadastro legado em visitante com reaprovação e retirada pendente', async () => {
    await db
      .update(schema.clients)
      .set({ enableVisitorApprove: true })
      .where(eq(schema.clients.id, clientId));
    await db
      .update(schema.registrations)
      .set({
        childApprovalRequired: false,
        birthDate: '1990-01-01',
        status: 'approved',
      })
      .where(eq(schema.registrations.id, childId));
    await visitorApprovals.regularize(actor(), clientId, childId);
    const row = await repository.registration(clientId, childId);
    expect(row?.isVisitor).toBe(true);
    expect(row?.visitorApprovalRequired).toBe(true);
    expect(row?.status).toBe('rejected');
    await admin.approveAutomatically(clientId, childId);
    await acceptVisitor();
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'approved',
    );
  });
  it('desligar flag suspende exigência sem restaurar rejeitado e mantém retirada', async () => {
    await configureVisitor();
    await admin.approveAutomatically(clientId, childId);
    await acceptVisitor();
    await visitorApprovals.revokeOwn(visitorEmails[0].token, cpf1);
    await db
      .update(schema.clients)
      .set({ enableVisitorApprove: false })
      .where(eq(schema.clients.id, clientId));
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'rejected',
    );
    expect(await policy.faceAllowed(clientId, 52)).toBe(false);
    await removal.run({
      id: randomUUID(),
      clientId,
      targetId: childId,
    } as never);
    expect(faceSync.removePersonFromReaders).toHaveBeenCalled();
  });

  it.each([false, true])(
    'cadastro público visitante com enableVisitorApprove=%s',
    async (enabled) => {
      await db
        .update(schema.clients)
        .set({
          enableVisitorApprove: enabled,
          enableChildApprove: false,
          autoApproveRegistrations: true,
        })
        .where(eq(schema.clients.id, clientId));
      const client = await repository.client(clientId);
      const [link] = await db
        .select()
        .from(schema.registrationLinks)
        .where(eq(schema.registrationLinks.clientId, clientId));
      const id = randomUUID();
      const publicRegistration = new PublicRegistrationService(
        database,
        { assertObjectExists: jest.fn() } as never,
        new ClientBlocksRepository(database),
        admin,
        approvals,
        visitorApprovals,
      );
      await publicRegistration.submit(link.code, {
        registrationId: id,
        isVisitor: true,
        name: 'Visitante público',
        document: '39053344705',
        phone: '65999998888',
        email: 'visit@example.test',
        birthDate: '1990-01-01',
        unitId,
        faceImageKey: `${client.companyId}/${clientId}/${id}/face.jpg`,
        truthDeclared: true,
      });
      const saved = await repository.registration(clientId, id);
      expect(saved?.isVisitor).toBe(true);
      expect(saved?.visitorApprovalRequired).toBe(enabled);
      expect(saved?.status).toBe(enabled ? 'draft' : 'approved');
      expect(visitorEmails).toHaveLength(enabled ? 2 : 0);
      if (enabled) {
        const sent = visitorEmails[0];
        await visitorApprovals.accept(sent.token, {
          cpf: cpf1,
          agreed: true,
          termVersion: (await visitorApprovals.preview(sent.token)).termVersion,
        });
        expect((await repository.registration(clientId, id))?.status).toBe(
          'approved',
        );
      }
    },
  );
  it('visitante exige unidade mesmo com configuração de localização oculta e flag desligada', async () => {
    await db
      .update(schema.clients)
      .set({
        enableChildApprove: false,
        enableVisitorApprove: false,
        registrationConfig: { block: 'hidden', unit: 'hidden' },
      })
      .where(eq(schema.clients.id, clientId));
    const client = await repository.client(clientId);
    const [link] = await db
      .select()
      .from(schema.registrationLinks)
      .where(eq(schema.registrationLinks.clientId, clientId));
    const id = randomUUID();
    const publicRegistration = new PublicRegistrationService(
      database,
      { assertObjectExists: jest.fn() } as never,
      new ClientBlocksRepository(database),
      admin,
      approvals,
      visitorApprovals,
    );
    await expect(
      publicRegistration.submit(link.code, {
        registrationId: id,
        isVisitor: true,
        name: 'Visitante público',
        document: '39053344705',
        phone: '65999998888',
        email: 'visit@example.test',
        birthDate: '1990-01-01',
        faceImageKey: `${client.companyId}/${clientId}/${id}/face.jpg`,
        truthDeclared: true,
      }),
    ).rejects.toThrow('unidade');
  });
  it('bloquear e desbloquear membro autorizador não restaura o aceite', async () => {
    await configureVisitor();
    await acceptVisitor();
    const [role] = await db
      .select()
      .from(schema.clientRoles)
      .where(eq(schema.clientRoles.clientId, clientId));
    const memberId = randomUUID();
    await db.insert(schema.clientMembers).values({
      id: memberId,
      clientId,
      roleId: role.id,
      registrationId: adult1Id,
      name: 'Adulto 1',
      unitId,
      birthDate: '1990-01-01',
    });
    await db
      .update(schema.clientMembers)
      .set({ blockedAt: new Date() })
      .where(eq(schema.clientMembers.id, memberId));
    await db
      .update(schema.clientMembers)
      .set({ blockedAt: null })
      .where(eq(schema.clientMembers.id, memberId));
    expect(await visitorRepository.activeConsentCount(clientId, childId)).toBe(
      0,
    );
  });
  it('e-mail alterado cancela token anterior e emite novo segredo', async () => {
    await configureVisitor();
    const old = visitorEmails[0].token;
    await db
      .update(schema.registrations)
      .set({ email: 'new-adult@example.test' })
      .where(eq(schema.registrations.id, adult1Id));
    await visitorApprovals.requestEmails(clientId, childId, true);
    expect(
      visitorEmails.find((e) => e.to === 'new-adult@example.test')?.token,
    ).not.toBe(old);
    await expect(visitorApprovals.preview(old)).rejects.toThrow();
  });
  it('concorrência entre mudança de unidade e aceite não deixa autorização inválida ativa', async () => {
    await configureVisitor();
    await Promise.allSettled([
      acceptVisitor(),
      db
        .update(schema.registrations)
        .set({ unitId: unit2Id })
        .where(eq(schema.registrations.id, adult1Id)),
    ]);
    expect(await visitorRepository.activeConsentCount(clientId, childId)).toBe(
      0,
    );
  });
  it('rejeição administrativa cancela link e não pode ser revertida pelo aceite antigo', async () => {
    await configureVisitor();
    await admin.rejectForClientTenant(actor(), childId, {
      notes: 'Dados não conferem',
    });
    await expect(acceptVisitor()).rejects.toThrow();
    expect((await repository.registration(clientId, childId))?.status).toBe(
      'rejected',
    );
  });
  it('aliases antigos de menores continuam protegidos pela autorização de visitante após maioridade', async () => {
    await configureVisitor();
    await db
      .insert(schema.childApprovalFaces)
      .values({ clientId, registrationId: childId, faceId: 77 });
    expect(await policy.faceAllowed(clientId, 77)).toBe(false);
    await admin.approveAutomatically(clientId, childId);
    await acceptVisitor();
    expect(await policy.faceAllowed(clientId, 77)).toBe(true);
    await visitorApprovals.revokeOwn(visitorEmails[0].token, cpf1);
    expect(await policy.faceAllowed(clientId, 77)).toBe(false);
  });
});
