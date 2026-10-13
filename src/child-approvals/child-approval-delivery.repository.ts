import { Injectable } from '@nestjs/common';
import { and, eq, isNull, lte, lt, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { childApprovalRequests } from '../database/schema';

@Injectable()
export class ChildApprovalDeliveryRepository {
  constructor(private readonly database: DatabaseService) {}

  async claim() {
    return this.database.db.transaction(async (db) => {
      const [row] = await db
        .select()
        .from(childApprovalRequests)
        .where(
          and(
            isNull(childApprovalRequests.canceledAt),
            isNull(childApprovalRequests.acceptedAt),
            isNull(childApprovalRequests.emailSentAt),
            lt(childApprovalRequests.emailAttempts, 8),
            lte(childApprovalRequests.emailNextAttemptAt, new Date()),
            or(
              isNull(childApprovalRequests.emailLockedAt),
              lt(
                childApprovalRequests.emailLockedAt,
                new Date(Date.now() - 120_000),
              ),
            ),
          ),
        )
        .orderBy(childApprovalRequests.emailNextAttemptAt)
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return null;
      const [claimed] = await db
        .update(childApprovalRequests)
        .set({
          emailLockedAt: new Date(),
          emailAttempts: sql`${childApprovalRequests.emailAttempts} + 1`,
        })
        .where(
          and(
            eq(childApprovalRequests.clientId, row.clientId),
            eq(childApprovalRequests.id, row.id),
          ),
        )
        .returning();
      return claimed;
    });
  }

  async finish(
    clientId: string,
    id: string,
    error: string | null,
    attempts: number,
  ) {
    await this.database.db
      .update(childApprovalRequests)
      .set({
        emailSentAt: error ? null : new Date(),
        emailError: error,
        emailLockedAt: null,
        emailNextAttemptAt: new Date(
          Date.now() + Math.min(3600_000, 30_000 * 2 ** attempts),
        ),
      })
      .where(
        and(
          eq(childApprovalRequests.clientId, clientId),
          eq(childApprovalRequests.id, id),
        ),
      );
  }
}
