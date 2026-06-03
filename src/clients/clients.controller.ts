import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ClientsService } from './clients.service';

@ApiTags('clients')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar clientes da empresa' })
  list(@CurrentUser() user: JwtPayload) {
    return this.clientsService.list(user);
  }

  @Get(':clientId/display-short-code')
  @ApiOperation({
    summary: 'Garante e retorna o código curto da URL do display em TV',
  })
  ensureDisplayShortCode(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.clientsService.ensureTvDisplayShortCode(user, clientId);
  }

  @Get(':clientId/display-token')
  @ApiOperation({
    summary:
      'Garante e retorna o token do display em TV da escola (URL pública SSE)',
  })
  ensureDisplayToken(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.clientsService.ensureTvDisplayToken(user, clientId);
  }

  @Post(':clientId/display-token/regenerate')
  @ApiOperation({
    summary: 'Regenerar token do display em TV (invalida URL antiga)',
  })
  regenerateDisplayToken(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.clientsService.regenerateTvDisplayToken(user, clientId);
  }

  @Get(':clientId/display-devices')
  @ApiOperation({
    summary:
      'Listar câmeras LPR e leitores faciais habilitados para o display TV',
  })
  getDisplayDevices(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.clientsService.getDisplayDevices(user, clientId);
  }

  @Put(':clientId/display-devices')
  @ApiOperation({
    summary: 'Configurar quais dispositivos alimentam o display TV',
  })
  setDisplayDevices(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ) {
    return this.clientsService.setDisplayDevices(user, clientId, body);
  }

  @Get(':clientId/client-users')
  @ApiOperation({ summary: 'Listar usuários do sistema vinculados ao cliente' })
  listClientUsers(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.clientsService.listClientUsers(user, clientId);
  }

  @Get(':clientId/invite-links')
  @ApiOperation({ summary: 'Listar convites ativos do cliente' })
  listClientInviteLinks(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.clientsService.listClientInviteLinks(user, clientId);
  }

  @Post(':clientId/invite-links')
  @ApiOperation({ summary: 'Gerar convite para admin/operador do cliente' })
  generateClientInviteLink(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ) {
    return this.clientsService.generateClientInviteLink(user, clientId, body);
  }

  @Patch(':clientId/active')
  @ApiOperation({
    summary: 'Ativar/inativar cliente (apenas admin da empresa)',
  })
  setActive(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ) {
    return this.clientsService.setActive(user, clientId, body);
  }

  @Get(':clientId')
  @ApiOperation({ summary: 'Obter cliente por ID' })
  getById(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.clientsService.getById(user, clientId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar cliente (apenas admin da empresa)' })
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.clientsService.create(user, body);
  }

  @Patch(':clientId')
  @ApiOperation({ summary: 'Atualizar cliente (apenas admin da empresa)' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ) {
    return this.clientsService.update(user, clientId, body);
  }
}
