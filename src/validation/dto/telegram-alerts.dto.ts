import { createZodDto } from 'nestjs-zod';

import {
  createTelegramLinkTokenSchema,
  telegramWebhookSchema,
  updateTelegramChatSchema,
} from '../telegram-alerts.schema';

export class CreateTelegramLinkTokenDto extends createZodDto(
  createTelegramLinkTokenSchema,
) {}

export class UpdateTelegramChatDto extends createZodDto(
  updateTelegramChatSchema,
) {}

export class TelegramWebhookDto extends createZodDto(telegramWebhookSchema) {}
