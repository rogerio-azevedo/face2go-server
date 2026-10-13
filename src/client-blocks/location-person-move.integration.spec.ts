import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as schema from '../database/schema';
import { LocationPersonMoveRepository } from './location-person-move.repository';
import type { DatabaseService } from '../database/database.service';

// Exclusively an opt-in disposable instance. Never uses DATABASE_URL or .env.
const run =
  process.env.LOCATION_MOVE_TEST_SOCKET === '/tmp' ? describe : describe.skip;
run('Individual location moves — PostgreSQL', () => {
  const connection = { host: '/tmp', port: 65432, user: 'location_test' };
  const admin = new Pool({ ...connection, database: 'postgres' });
  const pool = new Pool({
    ...connection,
    database: 'face2go_location_move_test',
    max: 5,
  });
  const db = drizzle(pool, { schema });
  const repository = new LocationPersonMoveRepository({
    db,
  } as unknown as DatabaseService);
  let clientId: string,
    actor: string,
    source: string,
    target: string,
    block: string,
    secondBlock: string,
    memberId: string,
    regId: string,
    otherId: string;
  beforeAll(async () => {
    await admin.query('CREATE DATABASE face2go_location_move_test');
    const statements = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          join(
            __dirname,
            '../../scripts/location-person-move-test-baseline.ts',
          ),
        ],
        { encoding: 'utf8' },
      ),
    ) as string[];
    for (const statement of statements) await pool.query(statement);
    await pool.query(
      readFileSync(
        join(__dirname, '../../drizzle/0091_location_person_moves.sql'),
        'utf8',
      ),
    );
  }, 30000);
  afterAll(async () => {
    await pool.end();
    await admin.query('DROP DATABASE IF EXISTS face2go_location_move_test');
    await admin.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE companies, "user" CASCADE');
    [
      clientId,
      actor,
      source,
      target,
      block,
      secondBlock,
      memberId,
      regId,
      otherId,
    ] = Array.from({ length: 9 }, () => randomUUID());
    const companyId = randomUUID(),
      roleId = randomUUID(),
      linkId = randomUUID();
    await db
      .insert(schema.users)
      .values({ id: actor, email: 'admin@example.test' });
    await db.insert(schema.companies).values({ id: companyId, name: 'Test' });
    await db
      .insert(schema.clients)
      .values({ id: clientId, companyId, name: 'Test', type: 'condominium' });
    await db.insert(schema.clientBlocks).values([
      { id: block, clientId, name: 'A' },
      { id: secondBlock, clientId, name: 'B' },
    ]);
    await db.insert(schema.clientUnits).values([
      { id: source, clientId, blockId: block, name: '101' },
      { id: target, clientId, blockId: secondBlock, name: '202' },
    ]);
    await db.insert(schema.registrationLinks).values({
      id: linkId,
      clientId,
      createdByUserId: actor,
      code: randomUUID(),
    });
    await db.insert(schema.registrations).values([
      {
        id: regId,
        clientId,
        registrationLinkId: linkId,
        unitId: source,
        name: 'Selected',
        status: 'approved',
        faceId: 1,
        additionalData: { block: 'A', unit: '101', room: 'keep-reg' },
      },
      {
        id: otherId,
        clientId,
        registrationLinkId: linkId,
        unitId: source,
        name: 'Other',
      },
    ]);
    await db
      .insert(schema.clientRoles)
      .values({ id: roleId, clientId, name: 'Morador', slug: 'resident' });
    await db.insert(schema.clientMembers).values({
      id: memberId,
      clientId,
      roleId,
      registrationId: regId,
      unitId: source,
      name: 'Selected',
      faceId: 1,
      additionalData: { block: 'A', unit: '101', room: 'keep-member' },
    });
  });
  const input = (kind: 'member' | 'registration' = 'member') => ({
    kind,
    personId: kind === 'member' ? memberId : regId,
    sourceUnitId: source,
    targetBlockId: secondBlock,
    targetUnitId: target,
  });
  const state = async () => ({
    regs: await db.select().from(schema.registrations),
    members: await db.select().from(schema.clientMembers),
    units: await db.select().from(schema.clientUnits),
    audit: await db.select().from(schema.locationPersonMoves),
  });
  it.each(['member', 'registration'] as const)(
    'moves only selected %s and its mirror, preserving fields and source activity',
    async (kind) => {
      await repository.move(clientId, actor, input(kind));
      const result = await state();
      expect(result.regs.find((r) => r.id === regId)).toMatchObject({
        unitId: target,
        status: 'approved',
        faceId: 1,
        additionalData: { block: 'B', unit: '202', room: 'keep-reg' },
      });
      expect(result.members[0]).toMatchObject({
        unitId: target,
        faceId: 1,
        additionalData: { block: 'B', unit: '202', room: 'keep-member' },
      });
      expect(result.regs.find((r) => r.id === otherId)?.unitId).toBe(source);
      expect(result.units.find((u) => u.id === source)?.isActive).toBe(true);
      expect(result.audit).toHaveLength(1);
      expect(result.audit[0]).toMatchObject({
        clientId,
        actorUserId: actor,
        personKind: kind,
        sourceUnitId: source,
        targetUnitId: target,
        sourceBlockName: 'A',
        sourceUnitName: '101',
        targetBlockName: 'B',
        targetUnitName: '202',
      });
    },
  );
  it('moves a standalone inactive member within the same block, keeping an empty source active', async () => {
    await db
      .update(schema.clientMembers)
      .set({ registrationId: null, isActive: false })
      .where(eq(schema.clientMembers.id, memberId));
    await db.update(schema.registrations).set({ unitId: null });
    await db
      .update(schema.clientUnits)
      .set({ blockId: block })
      .where(eq(schema.clientUnits.id, target));
    await repository.move(clientId, actor, {
      ...input(),
      targetBlockId: block,
    });
    const result = await state();
    expect(result.members[0]).toMatchObject({
      unitId: target,
      isActive: false,
    });
    expect(result.regs.every((r) => r.unitId === null)).toBe(true);
    expect(result.units.find((u) => u.id === source)?.isActive).toBe(true);
    expect(result.audit).toHaveLength(1);
  });
  it('moves a standalone registration without creating a member', async () => {
    await db.delete(schema.clientMembers);
    await repository.move(clientId, actor, input('registration'));
    expect((await state()).members).toHaveLength(0);
  });
  it.each([
    'unit',
    'block',
    'wrong-block',
    'same-unit',
    'other-client',
    'other-person',
  ])(
    'rejects invalid destination/scope: %s with no partial changes',
    async (reason) => {
      let request = input();
      let tenant = clientId;
      if (reason === 'unit')
        await db
          .update(schema.clientUnits)
          .set({ isActive: false })
          .where(eq(schema.clientUnits.id, target));
      if (reason === 'block')
        await db
          .update(schema.clientBlocks)
          .set({ isActive: false })
          .where(eq(schema.clientBlocks.id, secondBlock));
      if (reason === 'wrong-block')
        request = { ...request, targetBlockId: block };
      if (reason === 'same-unit')
        request = { ...request, targetUnitId: source, targetBlockId: block };
      if (reason === 'other-client') tenant = randomUUID();
      if (reason === 'other-person')
        request = { ...request, personId: randomUUID() };
      const before = await state();
      await expect(
        repository.move(tenant, actor, request),
      ).rejects.toBeInstanceOf(
        reason === 'other-client' || reason === 'other-person'
          ? NotFoundException
          : BadRequestException,
      );
      expect(await state()).toEqual(before);
    },
  );
  it('rejects a stale source and an inconsistent linked registration', async () => {
    await db
      .update(schema.registrations)
      .set({ unitId: target })
      .where(eq(schema.registrations.id, regId));
    const before = await state();
    await expect(
      repository.move(clientId, actor, input()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await state()).toEqual(before);
  });
  it('serializes simultaneous moves and rejects the second stale edit', async () => {
    const results = await Promise.allSettled([
      repository.move(clientId, actor, input()),
      repository.move(clientId, actor, input('registration')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect((await state()).audit).toHaveLength(1);
  });
  it('rolls back the move if the audit cannot be persisted', async () => {
    const before = await state();
    await pool.query(
      "CREATE FUNCTION reject_location_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$",
    );
    await pool.query(
      'CREATE TRIGGER reject_location_audit BEFORE INSERT ON location_person_moves FOR EACH ROW EXECUTE FUNCTION reject_location_audit()',
    );
    try {
      await expect(repository.move(clientId, actor, input())).rejects.toThrow();
      expect(await state()).toEqual(before);
    } finally {
      await pool.query(
        'DROP TRIGGER reject_location_audit ON location_person_moves',
      );
      await pool.query('DROP FUNCTION reject_location_audit()');
    }
  });
});
