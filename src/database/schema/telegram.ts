import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { clients } from './clients';

export const telegramChatTypeEnum = pgEnum('telegram_chat_type', [
  'private',
  'group',
  'supergroup',
]);

export const telegramChats = pgTable(
  'telegram_chats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    chatId: text('chat_id').notNull(),
    chatType: telegramChatTypeEnum('chat_type').notNull(),
    title: text('title'),
    username: text('username'),
    userId: text('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('telegram_chats_client_chat_unique').on(t.clientId, t.chatId),
    index('telegram_chats_chat_id_idx').on(t.chatId),
  ],
);

export const telegramLinkTokens = pgTable('telegram_link_tokens', {
  token: text('token').primaryKey(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  /** Nulo quando o link é para um grupo. */
  targetUserId: text('target_user_id').references(() => users.id, {
    onDelete: 'cascade',
  }),
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
