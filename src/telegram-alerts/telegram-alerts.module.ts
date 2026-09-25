import { Module } from '@nestjs/common';

import { TelegramBotClient } from '../integrations/telegram/telegram-bot.client';
import { TelegramAlertsController } from './telegram-alerts.controller';
import { TelegramAlertsRepository } from './telegram-alerts.repository';
import { TelegramAlertsService } from './telegram-alerts.service';
import { TelegramWebhookController } from './telegram-webhook.controller';

@Module({
  controllers: [TelegramWebhookController, TelegramAlertsController],
  providers: [
    TelegramBotClient,
    TelegramAlertsRepository,
    TelegramAlertsService,
  ],
  exports: [TelegramAlertsService],
})
export class TelegramAlertsModule {}
