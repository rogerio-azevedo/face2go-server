import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { TelegramWebhookDto } from '../validation/dto/telegram-alerts.dto';
import { TelegramAlertsService } from './telegram-alerts.service';

@ApiTags('telegram-alerts')
@Controller()
export class TelegramWebhookController {
  constructor(private readonly telegramAlerts: TelegramAlertsService) {}

  @Public()
  @Post('telegram/webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook do bot de alertas do Telegram' })
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() body: TelegramWebhookDto,
  ) {
    await this.telegramAlerts.handleWebhook(secret, body);
    return { ok: true };
  }
}
