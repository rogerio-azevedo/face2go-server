import { Injectable } from '@nestjs/common';
import { and, eq, isNull, lte, lt, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { visitorApprovalRequests } from '../database/schema';

@Injectable()
export class VisitorApprovalDeliveryRepository {
  constructor(private readonly database: DatabaseService) {}

  async claim() {
    return this.database.db.transaction(async (db) => {
      const [row] = await db
        .select()
        .from(visitorApprovalRequests)
        .where(
          and(
            isNull(visitorApprovalRequests.canceledAt),
            isNull(visitorApprovalRequests.acceptedAt),
            isNull(visitorApprovalRequests.emailSentAt),
            lt(visitorApprovalRequests.emailAttempts, 8),
            lte(visitorApprovalRequests.emailNextAttemptAt, new Date()),
            or(
              isNull(visitorApprovalRequests.emailLockedAt),
              lt(
                visitorApprovalRequests.emailLockedAt,
                new Date(Date.now() - 120_000),
              ),
            ),
          ),
        )
        .orderBy(visitorApprovalRequests.emailNextAttemptAt)
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return null;
      const [claimed] = await db
        .update(visitorApprovalRequests)
        .set({
          emailLockedAt: new Date(),
          emailAttempts: sql`${visitorApprovalRequests.emailAttempts} + 1`,
        })
        .where(
          and(
            eq(visitorApprovalRequests.clientId, row.clientId),
            eq(visitorApprovalRequests.id, row.id),
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
      .update(visitorApprovalRequests)
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
          eq(visitorApprovalRequests.clientId, clientId),
          eq(visitorApprovalRequests.id, id),
        ),
      );
  }
}
