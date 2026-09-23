import { and, eq, gt, isNull } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { clients, registrationFaceRetakeLinks, registrations } from '../schema';
import type { RegistrationRow } from './registrations.queries';

export type RegistrationFaceRetakeLinkRow =
  typeof registrationFaceRetakeLinks.$inferSelect;

export type FaceRetakeBundle = {
  link: RegistrationFaceRetakeLinkRow;
  registration: RegistrationRow;
  clientName: string;
  clientLogoUrl: string | null;
  clientIsActive: boolean;
  companyId: string;
};

export type ConsumeRetakeResult =
  | { ok: true; registration: RegistrationRow }
  | { ok: false; reason: 'invalid' | 'ineligible' };

export async function getFaceRetakeBundleByCode(
  db: AppDb,
  code: string,
): Promise<FaceRetakeBundle | undefined> {
  const [row] = await db
    .select({
      link: registrationFaceRetakeLinks,
      registration: registrations,
      clientName: clients.name,
      clientLogoUrl: clients.logoUrl,
      clientIsActive: clients.isActive,
      companyId: clients.companyId,
    })
    .from(registrationFaceRetakeLinks)
    .innerJoin(
      registrations,
      and(
        eq(registrations.id, registrationFaceRetakeLinks.registrationId),
        eq(registrations.clientId, registrationFaceRetakeLinks.clientId),
      ),
    )
    .innerJoin(clients, eq(clients.id, registrationFaceRetakeLinks.clientId))
    .where(eq(registrationFaceRetakeLinks.code, code))
    .limit(1);
  return row;
}

export async function insertFaceRetakeLinkReplacingOpen(
  db: AppDb,
  input: {
    registrationId: string;
    clientId: string;
    createdByUserId: string;
    code: string;
    expiresAt: Date;
  },
): Promise<RegistrationFaceRetakeLinkRow> {
  return db.transaction(async (tx) => {
    await tx
      .delete(registrationFaceRetakeLinks)
      .where(
        and(
          eq(registrationFaceRetakeLinks.registrationId, input.registrationId),
          eq(registrationFaceRetakeLinks.clientId, input.clientId),
          isNull(registrationFaceRetakeLinks.usedAt),
        ),
      );
    const [row] = await tx
      .insert(registrationFaceRetakeLinks)
      .values({
        registrationId: input.registrationId,
        clientId: input.clientId,
        createdByUserId: input.createdByUserId,
        code: input.code,
        expiresAt: input.expiresAt,
      })
      .returning();
    if (!row) {
      throw new Error('Falha ao gravar o link de recadastro.');
    }
    return row;
  });
}

export async function consumeFaceRetakeAndSetPhoto(
  db: AppDb,
  code: string,
  faceImageKey: string,
): Promise<ConsumeRetakeResult> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [link] = await tx
      .select()
      .from(registrationFaceRetakeLinks)
      .where(eq(registrationFaceRetakeLinks.code, code))
      .limit(1);
    if (!link || link.usedAt || link.expiresAt.getTime() <= now.getTime()) {
      return { ok: false, reason: 'invalid' };
    }

    const [joined] = await tx
      .select({
        registration: registrations,
        clientIsActive: clients.isActive,
      })
      .from(registrations)
      .innerJoin(clients, eq(clients.id, registrations.clientId))
      .where(
        and(
          eq(registrations.id, link.registrationId),
          eq(registrations.clientId, link.clientId),
        ),
      )
      .limit(1);

    if (!joined) {
      return { ok: false, reason: 'ineligible' };
    }
    const { registration, clientIsActive } = joined;
    const canRetake =
      clientIsActive &&
      registration.isActive &&
      registration.submittedAt != null &&
      (registration.status === 'draft' || registration.status === 'approved');
    if (!canRetake) {
      return { ok: false, reason: 'ineligible' };
    }

    const [consumed] = await tx
      .update(registrationFaceRetakeLinks)
      .set({ usedAt: now })
      .where(
        and(
          eq(registrationFaceRetakeLinks.id, link.id),
          isNull(registrationFaceRetakeLinks.usedAt),
          gt(registrationFaceRetakeLinks.expiresAt, now),
        ),
      )
      .returning({ id: registrationFaceRetakeLinks.id });
    if (!consumed) {
      return { ok: false, reason: 'invalid' };
    }

    const [updated] = await tx
      .update(registrations)
      .set({ faceImageKey, updatedAt: now })
      .where(
        and(
          eq(registrations.id, joined.registration.id),
          eq(registrations.clientId, link.clientId),
        ),
      )
      .returning();
    if (!updated) {
      return { ok: false, reason: 'ineligible' };
    }
    return { ok: true, registration: updated };
  });
}
