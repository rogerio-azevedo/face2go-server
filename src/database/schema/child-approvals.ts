import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { clients } from './clients';
import { registrations } from './registrations';

export type ChildApprovalSnapshot = {
  name: string;
  registrationId: string;
  birthDate: string | null;
  block: string | null;
  unit: string | null;
};

/** Tokens de solicitação/gestão; o segredo só é persistido cifrado para reenvio. */
export const childApprovalRequests = pgTable(
  'child_approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => registrations.id, { onDelete: 'restrict' }),
    adultRegistrationId: uuid('adult_registration_id')
      .notNull()
      .references(() => registrations.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    tokenEncrypted: text('token_encrypted').notNull(),
    email: text('email').notNull(),
    termVersion: text('term_version').notNull(),
    termContent: text('term_content').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    acceptedAt: timestamp('accepted_at'),
    canceledAt: timestamp('canceled_at'),
    verificationFailures: integer('verification_failures').default(0).notNull(),
    lockedUntil: timestamp('locked_until'),
    emailSentAt: timestamp('email_sent_at'),
    emailAttempts: integer('email_attempts').default(0).notNull(),
    emailNextAttemptAt: timestamp('email_next_attempt_at')
      .defaultNow()
      .notNull(),
    emailLockedAt: timestamp('email_locked_at'),
    emailError: text('email_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('child_approval_requests_token_uidx').on(t.tokenHash),
    uniqueIndex('child_approval_requests_open_uidx')
      .on(t.registrationId, t.adultRegistrationId)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.canceledAt} IS NULL`),
    index('child_approval_requests_client_registration_idx').on(
      t.clientId,
      t.registrationId,
    ),
  ],
);

/** Aceites independentes, com snapshots imutáveis; nunca apagar na revogação. */
export const childApprovalConsents = pgTable(
  'child_approval_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => registrations.id, { onDelete: 'restrict' }),
    adultRegistrationId: uuid('adult_registration_id')
      .notNull()
      .references(() => registrations.id, { onDelete: 'restrict' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => childApprovalRequests.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id').notNull(),
    childSnapshot: jsonb('child_snapshot')
      .$type<ChildApprovalSnapshot>()
      .notNull(),
    adultSnapshot: jsonb('adult_snapshot')
      .$type<ChildApprovalSnapshot>()
      .notNull(),
    termVersion: text('term_version').notNull(),
    termContent: text('term_content').notNull(),
    termHash: text('term_hash').notNull(),
    confirmationMethod: text('confirmation_method').notNull().default('cpf'),
    acceptedAt: timestamp('accepted_at').defaultNow().notNull(),
    revokedAt: timestamp('revoked_at'),
    revokedBy: text('revoked_by'),
    revocationReason: text('revocation_reason'),
  },
  (t) => [
    uniqueIndex('child_approval_consents_active_uidx')
      .on(t.registrationId, t.adultRegistrationId)
      .where(sql`${t.revokedAt} IS NULL`),
    uniqueIndex('child_approval_consents_request_uidx').on(t.requestId),
    index('child_approval_consents_client_registration_idx').on(
      t.clientId,
      t.registrationId,
    ),
  ],
);

export type ChildApprovalRequestRow = typeof childApprovalRequests.$inferSelect;

/** Identidades conhecidas do menor, inclusive aliases antigos em membros. */
export const childApprovalFaces = pgTable(
  'child_approval_faces',
  {
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => registrations.id, { onDelete: 'restrict' }),
    faceId: integer('face_id').notNull(),
  },
  (t) => [
    uniqueIndex('child_approval_faces_identity_uidx').on(
      t.clientId,
      t.registrationId,
      t.faceId,
    ),
  ],
);
