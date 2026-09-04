import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReadersService } from './readers.service';

@ApiTags('readers')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('readers')
export class ReadersController {
  constructor(private readonly readersService: ReadersService) {}

  @Get('monitor/status')
  @ApiOperation({
    summary:
      'Status de monitoramento (conexão stream / leitores Intelbras e Hikvision)',
  })
  monitorStatus(
    @CurrentUser() user: JwtPayload,
    @Query('clientId') clientId?: string,
  ) {
    return this.readersService.getMonitorStatus(user, clientId);
  }

  @Get()
  @ApiOperation({ summary: 'Listar leitores faciais da empresa' })
  list(@CurrentUser() user: JwtPayload, @Query('clientId') clientId?: string) {
    return this.readersService.list(user, clientId);
  }

  @Post('intelbras-push/provision-all')
  @ApiOperation({
    summary:
      'Provisionar POST Intelbras em todos os leitores Intelbras da empresa (ou de um cliente)',
  })
  provisionAllIntelbrasPush(
    @CurrentUser() user: JwtPayload,
    @Query('clientId') clientId?: string,
  ) {
    return this.readersService.provisionAllIntelbrasPush(user, clientId);
  }

  @Post()
  @ApiOperation({ summary: 'Cadastrar leitor (apenas admin da empresa)' })
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.readersService.create(user, body);
  }

  @Patch(':readerId')
  @ApiOperation({ summary: 'Atualizar leitor (apenas admin da empresa)' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Body() body: unknown,
  ) {
    return this.readersService.update(user, readerId, body);
  }

  @Get(':readerId/push-config')
  @ApiOperation({
    summary: 'Preview da config POST Intelbras (firmware + DeviceMode)',
  })
  pushConfig(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
  ) {
    return this.readersService.previewIntelbrasPush(user, readerId);
  }

  @Post(':readerId/provision-push')
  @ApiOperation({
    summary: 'Enviar config POST 1.0/2.0 ao leitor Intelbras',
  })
  provisionPush(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Query('mode') mode?: string,
  ) {
    return this.readersService.provisionIntelbrasPush(user, readerId, mode);
  }

  @Patch(':readerId/active')
  @ApiOperation({
    summary: 'Ativar/inativar leitor (apenas admin da empresa)',
  })
  setActive(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Body() body: unknown,
  ) {
    return this.readersService.setActive(user, readerId, body);
  }
}
