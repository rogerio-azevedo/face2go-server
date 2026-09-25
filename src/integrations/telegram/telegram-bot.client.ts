import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvVars } from '../../config/env.validation';

const API_BASE = 'https://api.telegram.org';

export type TelegramSendResult =
  { ok: true } | { ok: false; blocked: boolean; description: string };

@Injectable()
export class TelegramBotClient {
  private readonly logger = new Logger(TelegramBotClient.name);

  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  isConfigured(): boolean {
    return Boolean(this.token());
  }

  botUsername(): string | undefined {
    const username = this.config.get('TELEGRAM_BOT_USERNAME', { infer: true });
    return username?.replace(/^@/, '');
  }

  webhookSecret(): string | undefined {
    return this.config.get('TELEGRAM_WEBHOOK_SECRET', { infer: true });
  }

  async sendMessage(chatId: string, html: string): Promise<TelegramSendResult> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  async sendPhoto(
    chatId: string,
    photoUrl: string,
    caption: string,
  ): Promise<TelegramSendResult> {
    return this.call('sendPhoto', {
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: 'HTML',
    });
  }

  private token(): string | undefined {
    return this.config.get('TELEGRAM_BOT_TOKEN', { infer: true });
  }

  private async call(
    method: 'sendMessage' | 'sendPhoto',
    body: Record<string, unknown>,
  ): Promise<TelegramSendResult> {
    const token = this.token();
    if (!token) {
      return { ok: false, blocked: false, description: 'Bot não configurado.' };
    }

    const rawChatId = body.chat_id;
    const chatId =
      typeof rawChatId === 'string' || typeof rawChatId === 'number'
        ? String(rawChatId)
        : '';
    try {
      const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        return { ok: true };
      }
      const text = await res.text();
      const description = text.slice(0, 300);
      const blocked = res.status === 403;
      this.logger.warn(
        `Telegram ${method} chat=${chatId} HTTP ${res.status}: ${description}`,
      );
      return { ok: false, blocked, description };
    } catch (err: unknown) {
      const description = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Telegram ${method} chat=${chatId} falhou: ${description}`,
      );
      return { ok: false, blocked: false, description };
    }
  }
}
