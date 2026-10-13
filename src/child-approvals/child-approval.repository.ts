import { ChildApprovalRequestsRepository } from './child-approval-requests.repository';
import { Injectable } from '@nestjs/common';
import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import type { AppDb } from '../database/database.types';
import {
  clients,
  registrations,
  childApprovalFaces,
  clientMembers,
  registrationEvents,
} from '../database/schema';

export type ApprovalDb =
  AppDb | Parameters<Parameters<AppDb['transaction']>[0]>[0];

@Injectable()
export class ChildApprovalRepository extends ChildApprovalRequestsRepository {
  constructor(database: DatabaseService) {
    super(database);
  }

  transaction<T>(work: (db: ApprovalDb) => Promise<T>) {
    return this.database.db.transaction(work);
  }

  async client(clientId: string, db: ApprovalDb = this.database.db) {
    const [row] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    return row ?? null;
  }

  async registration(
    clientId: string,
    id: string,
    db: ApprovalDb = this.database.db,
    lock = false,
  ) {
    const query = db
      .select()
      .from(registrations)
      .where(
        and(eq(registrations.clientId, clientId), eq(registrations.id, id)),
      )
      .limit(1);
    const [row] = await (lock ? query.for('update') : query);
    return row ?? null;
  }

  async lockFace(db: ApprovalDb, clientId: string, faceId: number | null) {
    if (faceId != null)
      await db.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${clientId}), ${faceId})`,
      );
  }

  async registrationByFace(
    clientId: string,
    faceId: number,
    db: ApprovalDb = this.database.db,
  ) {
    return db
      .select({ registration: registrations, client: clients })
      .from(registrations)
      .innerJoin(clients, eq(clients.id, registrations.clientId))
      .where(
        and(
          eq(registrations.clientId, clientId),
          or(
            eq(registrations.faceId, faceId),
            sql`EXISTS (SELECT 1 FROM ${childApprovalFaces} WHERE ${childApprovalFaces.clientId} = ${clientId} AND ${childApprovalFaces.registrationId} = ${registrations.id} AND ${childApprovalFaces.faceId} = ${faceId})`,
            sql`EXISTS (SELECT 1 FROM ${clientMembers} WHERE ${clientMembers.clientId} = ${clientId} AND ${clientMembers.registrationId} = ${registrations.id} AND ${clientMembers.faceId} = ${faceId})`,
          ),
        ),
      );
  }

  async activeConsentCount(
    clientId: string,
    registrationId: string,
    db: ApprovalDb = this.database.db,
  ) {
    const [result] = await db
      .execute<{ total: string }>(
        sql`
      SELECT count(*)::text AS total FROM child_approval_consents c
      JOIN registrations child ON child.id = c.registration_id AND child.client_id = c.client_id
      JOIN registrations adult ON adult.id = c.adult_registration_id AND adult.client_id = c.client_id
      JOIN clients cl ON cl.id = c.client_id
      WHERE c.client_id = ${clientId} AND c.registration_id = ${registrationId} AND c.revoked_at IS NULL
        AND c.unit_id = child.unit_id AND c.unit_id = adult.unit_id
        AND adult.is_active = true AND adult.status = 'approved'
        AND adult.birth_date <= ((now() AT TIME ZONE 'UTC' + make_interval(mins => cl.timezone_offset_minutes))::date - interval '18 years')
    `,
      )
      .then((r) => r.rows);
    return Number(result?.total ?? 0);
  }

  async adultsInUnit(clientId: string, unitId: string) {
    return this.database.db
      .select()
      .from(registrations)
      .where(
        and(
          eq(registrations.clientId, clientId),
          eq(registrations.unitId, unitId),
          eq(registrations.status, 'approved'),
          eq(registrations.isActive, true),
        ),
      );
  }

  async enroll(
    clientId: string,
    registrationId: string,
    db: ApprovalDb = this.database.db,
  ) {
    await db
      .update(registrations)
      .set({ childApprovalRequired: true, updatedAt: new Date() })
      .where(
        and(
          eq(registrations.clientId, clientId),
          eq(registrations.id, registrationId),
        ),
      );
  }

  async requestApproval(
    clientId: string,
    registrationId: string,
    userId: string | null,
  ) {
    await this.database.db
      .update(registrations)
      .set({
        childApprovalRequestedAt: new Date(),
        childApprovalRequestedByUserId: userId,
      })
      .where(
        and(
          eq(registrations.clientId, clientId),
          eq(registrations.id, registrationId),
          eq(registrations.isActive, true),
        ),
      );
  }

  async clearApprovalIntent(
    clientId: string,
    registrationId: string,
    db: ApprovalDb = this.database.db,
  ) {
    await db
      .update(registrations)
      .set({
        childApprovalRequestedAt: null,
        childApprovalRequestedByUserId: null,
      })
      .where(
        and(
          eq(registrations.clientId, clientId),
          eq(registrations.id, registrationId),
        ),
      );
  }

  async pendingCases(limit = 100, offset = 0) {
    return this.database.db
      .select({ registration: registrations, client: clients })
      .from(registrations)
      .innerJoin(clients, eq(clients.id, registrations.clientId))
      .where(
        or(
          eq(registrations.childApprovalRemovalPending, true),
          and(
            eq(registrations.childApprovalRequired, true),
            eq(registrations.isActive, true),
            eq(clients.isActive, true),
            or(
              eq(clients.enableChildApprove, true),
              isNotNull(registrations.childApprovalRequestedAt),
            ),
          ),
        ),
      )
      .orderBy(registrations.id)
      .limit(limit)
      .offset(offset);
  }

  async patchRegistration(
    clientId: string,
    id: string,
    patch: Partial<typeof registrations.$inferInsert>,
    db: ApprovalDb = this.database.db,
  ) {
    await db
      .update(registrations)
      .set(patch)
      .where(
        and(eq(registrations.clientId, clientId), eq(registrations.id, id)),
      );
  }

  async faceIds(
    clientId: string,
    registrationId: string,
    db: ApprovalDb = this.database.db,
  ) {
    const [registration, members] = await Promise.all([
      this.registration(clientId, registrationId, db),
      db
        .select({ faceId: clientMembers.faceId })
        .from(clientMembers)
        .where(
          and(
            eq(clientMembers.clientId, clientId),
            eq(clientMembers.registrationId, registrationId),
          ),
        ),
    ]);
    const recorded = await db
      .select({ faceId: childApprovalFaces.faceId })
      .from(childApprovalFaces)
      .where(
        and(
          eq(childApprovalFaces.clientId, clientId),
          eq(childApprovalFaces.registrationId, registrationId),
        ),
      );
    return [
      ...new Set(
        [
          registration?.faceId,
          ...members.map((m) => m.faceId),
          ...recorded.map((r) => r.faceId),
        ].filter((id): id is number => id != null),
      ),
    ].sort((a, b) => a - b);
  }

  async rememberFaces(
    clientId: string,
    registrationId: string,
    db: ApprovalDb = this.database.db,
  ) {
    const ids = await this.faceIds(clientId, registrationId, db);
    if (ids.length)
      await db
        .insert(childApprovalFaces)
        .values(ids.map((faceId) => ({ clientId, registrationId, faceId })))
        .onConflictDoNothing();
  }

  async trackedFaces(clientId: string) {
    const rows = await this.database.db
      .select({ faceId: childApprovalFaces.faceId })
      .from(childApprovalFaces)
      .where(eq(childApprovalFaces.clientId, clientId));
    return rows.map((r) => r.faceId);
  }

  async regularize(
    clientId: string,
    registrationId: string,
    userId: string,
    db: ApprovalDb,
  ) {
    const now = new Date();
    await this.rememberFaces(clientId, registrationId, db);
    await this.patchRegistration(
      clientId,
      registrationId,
      {
        childApprovalRequired: true,
        childApprovalRemovalPending: true,
        childApprovalRequestedAt: null,
        childApprovalRequestedByUserId: null,
        status: 'rejected',
        approvedByUserId: userId,
        approvedAt: now,
        rejectionNotes:
          'Regularização: autorização de adulto da mesma unidade necessária.',
        updatedAt: now,
      },
      db,
    );
    await this.deactivateMembers(clientId, registrationId, db);
    await this.recordRejection(
      clientId,
      registrationId,
      userId,
      'Cadastro encaminhado manualmente para regularização de autorização de menor.',
      db,
    );
  }

  async deactivateMembers(
    clientId: string,
    registrationId: string,
    db: ApprovalDb,
  ) {
    await db
      .update(clientMembers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(clientMembers.clientId, clientId),
          eq(clientMembers.registrationId, registrationId),
        ),
      );
  }

  async recordRejection(
    clientId: string,
    registrationId: string,
    authorUserId: string | null,
    body: string,
    db: ApprovalDb,
  ) {
    await db.insert(registrationEvents).values({
      clientId,
      registrationId,
      authorUserId,
      type: 'rejected',
      body,
    });
  }
}
