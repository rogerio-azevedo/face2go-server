import { and, eq, gt } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { verificationTokens } from '../schema';

export async function deleteVerificationTokensByIdentifier(
  db: AppDb,
  identifier: string,
) {
  await db
    .delete(verificationTokens)
    .where(eq(verificationTokens.identifier, identifier));
}

export async function insertVerificationToken(
  db: AppDb,
  identifier: string,
  token: string,
  expiresAt: Date,
) {
  await deleteVerificationTokensByIdentifier(db, identifier);
  await db.insert(verificationTokens).values({
    identifier,
    token,
    expires: expiresAt,
  });
}

export async function findValidVerificationToken(db: AppDb, token: string) {
  const [row] = await db
    .select()
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.token, token),
        gt(verificationTokens.expires, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function deleteVerificationToken(
  db: AppDb,
  identifier: string,
  token: string,
) {
  await db
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.token, token),
      ),
    );
}
