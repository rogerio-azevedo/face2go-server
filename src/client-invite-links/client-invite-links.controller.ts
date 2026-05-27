import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ClientInviteLinksService } from './client-invite-links.service';

@ApiTags('client-invite-links')
@Controller()
export class ClientInviteLinksController {
  constructor(
    private readonly clientInviteLinksService: ClientInviteLinksService,
  ) {}

  @Public()
  @Get('client-invite-links/:code')
  @ApiOperation({ summary: 'Pré-visualizar convite de cliente (público)' })
  preview(@Param('code') code: string) {
    return this.clientInviteLinksService.preview(code);
  }

  @ApiBearerAuth()
  @Roles('client_admin')
  @Get('client/invite-links')
  @ApiOperation({ summary: 'Listar convites ativos do cliente atual' })
  list(@CurrentUser() user: JwtPayload) {
    return this.clientInviteLinksService.listForCurrentClient(user);
  }

  @ApiBearerAuth()
  @Roles('client_admin')
  @Post('client/invite-links')
  @ApiOperation({ summary: 'Gerar convite para admin/operador do cliente' })
  generate(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.clientInviteLinksService.generateForCurrentClient(user, body);
  }

  @ApiBearerAuth()
  @Roles('client_admin')
  @Get('client/client-users')
  @ApiOperation({ summary: 'Listar usuários do sistema do cliente atual' })
  listClientUsers(@CurrentUser() user: JwtPayload) {
    return this.clientInviteLinksService.listClientUsersForCurrentClient(user);
  }
}
