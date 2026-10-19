import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import type { AppDb } from '../database/database.types';
import {
  clientMembers,
  visitorApprovalRequests,
  visitorApprovalConsents,
  facialReaders,
} from '../database/schema';

export type ApprovalDb =
  AppDb | Parameters<Parameters<AppDb['transaction']>[0]>[0];

@Injectable()
export class VisitorApprovalRequestsRepository {
  constructor(protected readonly database: DatabaseService) {}

  async history(clientId: string, registrationId: string) {
    return this.database.db
      .select()
      .from(visitorApprovalConsents)
      .where(
        and(
          eq(visitorApprovalConsents.clientId, clientId),
          eq(visitorApprovalConsents.registrationId, registrationId),
        ),
      )
      .orderBy(visitorApprovalConsents.acceptedAt);
  }

  async requests(clientId: string, registrationId: string) {
    return this.database.db
      .select()
      .from(visitorApprovalRequests)
      .where(
        and(
          eq(visitorApprovalRequests.clientId, clientId),
          eq(visitorApprovalRequests.registrationId, registrationId),
        ),
      );
  }

  // Public opaque token is the capability; all subsequent reads use its stored clientId.
  async requestByHash(tokenHash: string) {
    const [row] = await this.database.db
      .select()
      .from(visitorApprovalRequests)
      .where(eq(visitorApprovalRequests.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async lockedRequest(clientId: string, id: string, db: ApprovalDb) {
    const [row] = await db
      .select()
      .from(visitorApprovalRequests)
      .where(
        and(
          eq(visitorApprovalRequests.clientId, clientId),
          eq(visitorApprovalRequests.id, id),
        ),
      )
      .for('update')
      .limit(1);
    return row ?? null;
  }

  async insertRequest(
    input: typeof visitorApprovalRequests.$inferInsert,
    db: ApprovalDb,
  ) {
    return db
      .insert(visitorApprovalRequests)
      .values(input)
      .onConflictDoNothing()
      .returning();
  }

  async updateRequest(
    clientId: string,
    id: string,
    patch: Partial<typeof visitorApprovalRequests.$inferInsert>,
    db: ApprovalDb = this.database.db,
  ) {
    await db
      .update(visitorApprovalRequests)
      .set(patch)
      .where(
        and(
          eq(visitorApprovalRequests.clientId, clientId),
          eq(visitorApprovalRequests.id, id),
        ),
      );
  }

  async insertConsent(
    input: typeof visitorApprovalConsents.$inferInsert,
    db: ApprovalDb,
  ) {
    const [row] = await db
      .insert(visitorApprovalConsents)
      .values(input)
      .onConflictDoNothing()
      .returning();
    return row;
  }

  async consent(
    clientId: string,
    id: string,
    db: ApprovalDb = this.database.db,
  ) {
    const [row] = await db
      .select()
      .from(visitorApprovalConsents)
      .where(
        and(
          eq(visitorApprovalConsents.clientId, clientId),
          eq(visitorApprovalConsents.id, id),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async consentByRequest(
    clientId: string,
    requestId: string,
    db: ApprovalDb = this.database.db,
  ) {
    const [row] = await db
      .select()
      .from(visitorApprovalConsents)
      .where(
        and(
          eq(visitorApprovalConsents.clientId, clientId),
          eq(visitorApprovalConsents.requestId, requestId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async revoke(
    clientId: string,
    id: string,
    actor: string,
    reason: string,
    db: ApprovalDb,
  ) {
    const [row] = await db
      .update(visitorApprovalConsents)
      .set({
        revokedAt: new Date(),
        revokedBy: actor,
        revocationReason: reason,
      })
      .where(
        and(
          eq(visitorApprovalConsents.clientId, clientId),
          eq(visitorApprovalConsents.id, id),
          isNull(visitorApprovalConsents.revokedAt),
        ),
      )
      .returning();
    return row;
  }

  async activeReaderCount(clientId: string, db: ApprovalDb) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(facialReaders)
      .where(
        and(
          eq(facialReaders.clientId, clientId),
          eq(facialReaders.isActive, true),
        ),
      );
    return row.count;
  }

  async clearMemberSync(
    clientId: string,
    registrationId: string,
    db: ApprovalDb,
  ) {
    await db
      .update(clientMembers)
      .set({
        deviceSyncStatus: null,
        deviceSyncError: null,
        deviceSyncedAt: null,
      })
      .where(
        and(
          eq(clientMembers.clientId, clientId),
          eq(clientMembers.registrationId, registrationId),
        ),
      );
  }

  async cancelOpenRequests(
    clientId: string,
    registrationId: string,
    db: ApprovalDb = this.database.db,
  ) {
    await db
      .update(visitorApprovalRequests)
      .set({ canceledAt: new Date() })
      .where(
        and(
          eq(visitorApprovalRequests.clientId, clientId),
          eq(visitorApprovalRequests.registrationId, registrationId),
          isNull(visitorApprovalRequests.acceptedAt),
          isNull(visitorApprovalRequests.canceledAt),
        ),
      );
  }
}
