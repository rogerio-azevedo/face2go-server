import { and, desc, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { registrationEvents, users } from '../schema';

export type RegistrationEventType =
  (typeof registrationEvents.$inferSelect)['type'];

export type RegistrationEventRow = typeof registrationEvents.$inferSelect;

export type RegistrationEventListRow = {
  id: string;
  type: RegistrationEventType;
  body: string | null;
  authorName: string | null;
  createdAt: Date;
};

export async function insertRegistrationEvent(
  db: AppDb,
  input: {
    registrationId: string;
    clientId: string;
    type: RegistrationEventType;
    body: string | null;
    authorUserId: string | null;
  },
): Promise<RegistrationEventRow> {
  const [row] = await db
    .insert(registrationEvents)
    .values({
      registrationId: input.registrationId,
      clientId: input.clientId,
      type: input.type,
      body: input.body,
      authorUserId: input.authorUserId,
    })
    .returning();
  if (!row) {
    throw new Error('Falha ao gravar ocorrência do cadastro.');
  }
  return row;
}

export async function listRegistrationEvents(
  db: AppDb,
  clientId: string,
  registrationId: string,
): Promise<RegistrationEventListRow[]> {
  return db
    .select({
      id: registrationEvents.id,
      type: registrationEvents.type,
      body: registrationEvents.body,
      authorName: users.name,
      createdAt: registrationEvents.createdAt,
    })
    .from(registrationEvents)
    .leftJoin(users, eq(users.id, registrationEvents.authorUserId))
    .where(
      and(
        eq(registrationEvents.clientId, clientId),
        eq(registrationEvents.registrationId, registrationId),
      ),
    )
    .orderBy(desc(registrationEvents.createdAt));
}

export async function findUserName(
  db: AppDb,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.name ?? null;
}
