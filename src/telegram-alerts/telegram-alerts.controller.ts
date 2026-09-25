import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateTelegramLinkTokenDto,
  UpdateTelegramChatDto,
} from '../validation/dto/telegram-alerts.dto';
import { TelegramAlertsService } from './telegram-alerts.service';

@ApiTags('telegram-alerts')
@ApiBearerAuth()
@Roles('client_admin')
@Controller('client/telegram-alerts')
export class TelegramAlertsController {
  constructor(private readonly telegramAlerts: TelegramAlertsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar chats do Telegram vinculados ao cliente' })
  list(@CurrentUser() user: JwtPayload) {
    return this.telegramAlerts.list(user);
  }

  @Post('link-token')
  @ApiOperation({ summary: 'Gerar link de vínculo de usuário ou grupo' })
  createLinkToken(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTelegramLinkTokenDto,
  ) {
    return this.telegramAlerts.createLinkToken(user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Ativar ou desativar um chat do Telegram' })
  setActive(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTelegramChatDto,
  ) {
    return this.telegramAlerts.setActive(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover um chat do Telegram' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.telegramAlerts.remove(user, id);
  }
}
