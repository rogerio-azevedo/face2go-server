import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';

import { DatabaseService } from '../database/database.service';
import { users } from '../database/schema/auth';
import {
  telegramChats,
  telegramLinkTokens,
  type telegramChatTypeEnum,
} from '../database/schema/telegram';

export type TelegramChatType = (typeof telegramChatTypeEnum.enumValues)[number];

export type TelegramChatRow = {
  id: string;
  chatId: string;
  chatType: TelegramChatType;
  title: string | null;
  username: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  isActive: boolean;
  createdAt: Date;
};

export type UpsertTelegramChatInput = {
  clientId: string;
  chatId: string;
  chatType: TelegramChatType;
  title: string | null;
  username: string | null;
  userId: string | null;
};

@Injectable()
export class TelegramAlertsRepository {
  constructor(private readonly database: DatabaseService) {}

  listByClient(clientId: string): Promise<TelegramChatRow[]> {
    return this.database.db
      .select({
        id: telegramChats.id,
        chatId: telegramChats.chatId,
        chatType: telegramChats.chatType,
        title: telegramChats.title,
        username: telegramChats.username,
        userId: telegramChats.userId,
        userName: users.name,
        userEmail: users.email,
        isActive: telegramChats.isActive,
        createdAt: telegramChats.createdAt,
      })
      .from(telegramChats)
      .leftJoin(users, eq(telegramChats.userId, users.id))
      .where(eq(telegramChats.clientId, clientId))
      .orderBy(desc(telegramChats.createdAt));
  }

  listActiveByClient(clientId: string) {
    return this.database.db
      .select({
        id: telegramChats.id,
        chatId: telegramChats.chatId,
      })
      .from(telegramChats)
      .where(
        and(
          eq(telegramChats.clientId, clientId),
          eq(telegramChats.isActive, true),
        ),
      );
  }

  upsertChat(input: UpsertTelegramChatInput) {
    const now = new Date();
    return this.database.db
      .insert(telegramChats)
      .values({
        clientId: input.clientId,
        chatId: input.chatId,
        chatType: input.chatType,
        title: input.title,
        username: input.username,
        userId: input.userId,
        isActive: true,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [telegramChats.clientId, telegramChats.chatId],
        set: {
          chatType: input.chatType,
          title: input.title,
          username: input.username,
          userId: input.userId,
          isActive: true,
          updatedAt: now,
        },
      })
      .returning({ id: telegramChats.id });
  }

  setActive(clientId: string, id: string, isActive: boolean) {
    return this.database.db
      .update(telegramChats)
      .set({ isActive, updatedAt: new Date() })
      .where(
        and(eq(telegramChats.id, id), eq(telegramChats.clientId, clientId)),
      )
      .returning({ id: telegramChats.id });
  }

  delete(clientId: string, id: string) {
    return this.database.db
      .delete(telegramChats)
      .where(
        and(eq(telegramChats.id, id), eq(telegramChats.clientId, clientId)),
      )
      .returning({ id: telegramChats.id });
  }

  deactivateByChatId(chatId: string) {
    return this.database.db
      .update(telegramChats)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(telegramChats.chatId, chatId));
  }

  createLinkToken(input: {
    token: string;
    clientId: string;
    targetUserId: string | null;
    createdByUserId: string;
    expiresAt: Date;
  }) {
    return this.database.db.insert(telegramLinkTokens).values(input);
  }

  findUsableLinkToken(token: string) {
    return this.database.db
      .select({
        clientId: telegramLinkTokens.clientId,
        targetUserId: telegramLinkTokens.targetUserId,
      })
      .from(telegramLinkTokens)
      .where(
        and(
          eq(telegramLinkTokens.token, token),
          isNull(telegramLinkTokens.usedAt),
          gt(telegramLinkTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
  }

  consumeLinkToken(token: string) {
    return this.database.db
      .update(telegramLinkTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(telegramLinkTokens.token, token),
          isNull(telegramLinkTokens.usedAt),
          gt(telegramLinkTokens.expiresAt, new Date()),
        ),
      )
      .returning({
        clientId: telegramLinkTokens.clientId,
        targetUserId: telegramLinkTokens.targetUserId,
      });
  }
}
