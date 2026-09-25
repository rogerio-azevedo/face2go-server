import { randomBytes, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as clientUsersQueries from '../database/queries/client-users.queries';
import { TelegramBotClient } from '../integrations/telegram/telegram-bot.client';
import {
  parseTelegramUpdate,
  type ParsedTelegramUpdate,
} from '../integrations/telegram/telegram-update.parser';
import type { AccessBlockedAttemptPayload } from '../notifications/notifications.events';
import type {
  CreateTelegramLinkTokenDto,
  TelegramWebhookDto,
  UpdateTelegramChatDto,
} from '../validation/dto/telegram-alerts.dto';
import { formatBlockedAttemptMessage } from './format-blocked-attempt-message';
import { TelegramAlertsRepository } from './telegram-alerts.repository';

const LINK_TTL_MS = 15 * 60 * 1000;

function secretsMatch(expected: string, received: string | undefined): boolean {
  if (!received) {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

@Injectable()
export class TelegramAlertsService {
  private readonly logger = new Logger(TelegramAlertsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly repository: TelegramAlertsRepository,
    private readonly bot: TelegramBotClient,
  ) {}

  list(user: JwtPayload) {
    return this.repository
      .listByClient(this.clientIdOf(user))
      .then((chats) => ({ chats }));
  }

  async createLinkToken(user: JwtPayload, dto: CreateTelegramLinkTokenDto) {
    const clientId = this.clientIdOf(user);
    const username = this.bot.botUsername();
    if (!this.bot.isConfigured() || !username) {
      throw new BadRequestException('Telegram não está configurado.');
    }

    const targetUserId =
      dto.kind === 'user' ? (dto.targetUserId ?? null) : null;
    if (targetUserId) {
      const link = await clientUsersQueries.getClientUserLink(
        this.database.db,
        targetUserId,
        clientId,
      );
      if (!link?.isActive) {
        throw new BadRequestException(
          'Usuário não pertence à equipe deste cliente.',
        );
      }
    }

    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await this.repository.createLinkToken({
      token,
      clientId,
      targetUserId,
      createdByUserId: user.sub,
      expiresAt,
    });

    const param = dto.kind === 'group' ? 'startgroup' : 'start';
    return {
      url: `https://t.me/${username}?${param}=${token}`,
      expiresAt,
    };
  }

  async setActive(user: JwtPayload, id: string, dto: UpdateTelegramChatDto) {
    const rows = await this.repository.setActive(
      this.clientIdOf(user),
      id,
      dto.isActive,
    );
    if (rows.length === 0) {
      throw new NotFoundException('Chat não encontrado.');
    }
    return { id };
  }

  async remove(user: JwtPayload, id: string) {
    const rows = await this.repository.delete(this.clientIdOf(user), id);
    if (rows.length === 0) {
      throw new NotFoundException('Chat não encontrado.');
    }
    return { id };
  }

  async notifyBlockedAttempt(
    payload: AccessBlockedAttemptPayload,
    snapUrl: string | null,
  ): Promise<void> {
    if (!this.bot.isConfigured()) {
      return;
    }
    try {
      const chats = await this.repository.listActiveByClient(payload.clientId);
      if (chats.length === 0) {
        return;
      }
      const text = formatBlockedAttemptMessage(payload);
      await Promise.all(
        chats.map((chat) => this.deliver(chat.chatId, text, snapUrl)),
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Telegram tentativa bloqueada falhou (client=${payload.clientId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async handleWebhook(
    secret: string | undefined,
    body: TelegramWebhookDto,
  ): Promise<void> {
    const expected = this.bot.webhookSecret();
    if (
      !this.bot.isConfigured() ||
      !expected ||
      !secretsMatch(expected, secret)
    ) {
      throw new UnauthorizedException('Webhook do Telegram recusado.');
    }

    const update = parseTelegramUpdate(body);
    if (update.kind === 'ignore') {
      return;
    }
    if (update.kind === 'start_without_token') {
      await this.bot.sendMessage(
        update.chatId,
        'Abra o link gerado no painel Face2Go para vincular este chat.',
      );
      return;
    }
    if (update.kind === 'stop' || update.kind === 'bot_removed') {
      await this.repository.deactivateByChatId(update.chatId);
      if (update.kind === 'stop') {
        await this.bot.sendMessage(
          update.chatId,
          'Alertas desativados neste chat.',
        );
      }
      return;
    }
    await this.consumeStart(update);
  }

  private async consumeStart(
    update: Extract<ParsedTelegramUpdate, { kind: 'start' }>,
  ): Promise<void> {
    const [token] = await this.repository.findUsableLinkToken(update.token);
    if (!token) {
      await this.bot.sendMessage(
        update.chatId,
        'Link inválido ou expirado. Gere outro no painel Face2Go.',
      );
      return;
    }

    const expectsGroup = token.targetUserId === null;
    const isGroup =
      update.chatType === 'group' || update.chatType === 'supergroup';
    if (expectsGroup !== isGroup) {
      await this.bot.sendMessage(
        update.chatId,
        expectsGroup
          ? 'Este link é para um grupo. Adicione o bot ao grupo pelo link do painel.'
          : 'Este link é para um usuário. Abra no chat privado com o bot.',
      );
      return;
    }

    const consumed = await this.repository.consumeLinkToken(update.token);
    if (consumed.length === 0) {
      await this.bot.sendMessage(
        update.chatId,
        'Link inválido ou expirado. Gere outro no painel Face2Go.',
      );
      return;
    }

    await this.repository.upsertChat({
      clientId: token.clientId,
      chatId: update.chatId,
      chatType: update.chatType,
      title: update.title,
      username: update.username,
      userId: token.targetUserId,
    });
    await this.bot.sendMessage(
      update.chatId,
      expectsGroup
        ? 'Grupo vinculado. Os alertas de tentativa bloqueada serão enviados aqui.'
        : 'Pronto. Este chat vai receber alertas de tentativa bloqueada.',
    );
  }

  private async deliver(
    chatId: string,
    text: string,
    snapUrl: string | null,
  ): Promise<void> {
    const photo = snapUrl
      ? await this.bot.sendPhoto(chatId, snapUrl, text)
      : null;
    if (photo?.ok) {
      return;
    }
    if (photo?.blocked) {
      await this.repository.deactivateByChatId(chatId);
      return;
    }
    const message = await this.bot.sendMessage(chatId, text);
    if (!message.ok && message.blocked) {
      await this.repository.deactivateByChatId(chatId);
    }
  }

  private clientIdOf(user: JwtPayload): string {
    if (!user.clientId) {
      throw new ForbiddenException('Contexto de cliente obrigatório.');
    }
    return user.clientId;
  }
}
