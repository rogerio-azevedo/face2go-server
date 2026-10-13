import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import type { AppDb } from '../database/database.types';
import {
  clientMembers,
  childApprovalRequests,
  childApprovalConsents,
  facialReaders,
} from '../database/schema';

export type ApprovalDb =
  AppDb | Parameters<Parameters<AppDb['transaction']>[0]>[0];

@Injectable()
export class ChildApprovalRequestsRepository {
  constructor(protected readonly database: DatabaseService) {}

  async history(clientId: string, registrationId: string) {
    return this.database.db
      .select()
      .from(childApprovalConsents)
      .where(
        and(
          eq(childApprovalConsents.clientId, clientId),
          eq(childApprovalConsents.registrationId, registrationId),
        ),
      )
      .orderBy(childApprovalConsents.acceptedAt);
  }

  async requests(clientId: string, registrationId: string) {
    return this.database.db
      .select()
      .from(childApprovalRequests)
      .where(
        and(
          eq(childApprovalRequests.clientId, clientId),
          eq(childApprovalRequests.registrationId, registrationId),
        ),
      );
  }

  // Public opaque token is the capability; all subsequent reads use its stored clientId.
  async requestByHash(tokenHash: string) {
    const [row] = await this.database.db
      .select()
      .from(childApprovalRequests)
      .where(eq(childApprovalRequests.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async lockedRequest(clientId: string, id: string, db: ApprovalDb) {
    const [row] = await db
      .select()
      .from(childApprovalRequests)
      .where(
        and(
          eq(childApprovalRequests.clientId, clientId),
          eq(childApprovalRequests.id, id),
        ),
      )
      .for('update')
      .limit(1);
    return row ?? null;
  }

  async insertRequest(
    input: typeof childApprovalRequests.$inferInsert,
    db: ApprovalDb,
  ) {
    return db
      .insert(childApprovalRequests)
      .values(input)
      .onConflictDoNothing()
      .returning();
  }

  async updateRequest(
    clientId: string,
    id: string,
    patch: Partial<typeof childApprovalRequests.$inferInsert>,
    db: ApprovalDb = this.database.db,
  ) {
    await db
      .update(childApprovalRequests)
      .set(patch)
      .where(
        and(
          eq(childApprovalRequests.clientId, clientId),
          eq(childApprovalRequests.id, id),
        ),
      );
  }

  async insertConsent(
    input: typeof childApprovalConsents.$inferInsert,
    db: ApprovalDb,
  ) {
    const [row] = await db
      .insert(childApprovalConsents)
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
      .from(childApprovalConsents)
      .where(
        and(
          eq(childApprovalConsents.clientId, clientId),
          eq(childApprovalConsents.id, id),
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
      .from(childApprovalConsents)
      .where(
        and(
          eq(childApprovalConsents.clientId, clientId),
          eq(childApprovalConsents.requestId, requestId),
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
      .update(childApprovalConsents)
      .set({
        revokedAt: new Date(),
        revokedBy: actor,
        revocationReason: reason,
      })
      .where(
        and(
          eq(childApprovalConsents.clientId, clientId),
          eq(childApprovalConsents.id, id),
          isNull(childApprovalConsents.revokedAt),
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
      .update(childApprovalRequests)
      .set({ canceledAt: new Date() })
      .where(
        and(
          eq(childApprovalRequests.clientId, clientId),
          eq(childApprovalRequests.registrationId, registrationId),
          isNull(childApprovalRequests.acceptedAt),
          isNull(childApprovalRequests.canceledAt),
        ),
      );
  }
}
