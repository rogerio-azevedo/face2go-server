import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ClientUsersService } from '../client-users/client-users.service';
import {
  PatchClientUserActiveDto,
  PatchClientUserPasswordDto,
  PatchClientUserProfileDto,
  PatchClientUserRoleDto,
} from '../validation/dto/client-users.dto';
import { ClientInviteLinksService } from './client-invite-links.service';

@ApiTags('client-invite-links')
@Controller()
export class ClientInviteLinksController {
  constructor(
    private readonly clientInviteLinksService: ClientInviteLinksService,
    private readonly clientUsersService: ClientUsersService,
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

  @ApiBearerAuth()
  @Roles('client_admin')
  @Patch('client/client-users/:clientUserId/profile')
  @ApiOperation({ summary: 'Atualizar nome e e-mail do usuário do cliente' })
  updateClientUserProfile(
    @CurrentUser() user: JwtPayload,
    @Param('clientUserId', ParseUUIDPipe) clientUserId: string,
    @Body() body: PatchClientUserProfileDto,
  ) {
    return this.clientUsersService.updateProfile(
      user,
      user.clientId ?? '',
      clientUserId,
      body,
    );
  }

  @ApiBearerAuth()
  @Roles('client_admin')
  @Patch('client/client-users/:clientUserId/role')
  @ApiOperation({ summary: 'Alterar papel do usuário do cliente' })
  updateClientUserRole(
    @CurrentUser() user: JwtPayload,
    @Param('clientUserId', ParseUUIDPipe) clientUserId: string,
    @Body() body: PatchClientUserRoleDto,
  ) {
    return this.clientUsersService.updateRole(
      user,
      user.clientId ?? '',
      clientUserId,
      body,
    );
  }

  @ApiBearerAuth()
  @Roles('client_admin')
  @Patch('client/client-users/:clientUserId/active')
  @ApiOperation({ summary: 'Ativar/desativar usuário do cliente' })
  setClientUserActive(
    @CurrentUser() user: JwtPayload,
    @Param('clientUserId', ParseUUIDPipe) clientUserId: string,
    @Body() body: PatchClientUserActiveDto,
  ) {
    return this.clientUsersService.setActive(
      user,
      user.clientId ?? '',
      clientUserId,
      body,
    );
  }

  @ApiBearerAuth()
  @Roles('client_admin')
  @Patch('client/client-users/:clientUserId/password')
  @ApiOperation({ summary: 'Definir nova senha do usuário do cliente' })
  setClientUserPassword(
    @CurrentUser() user: JwtPayload,
    @Param('clientUserId', ParseUUIDPipe) clientUserId: string,
    @Body() body: PatchClientUserPasswordDto,
  ) {
    return this.clientUsersService.setPassword(
      user,
      user.clientId ?? '',
      clientUserId,
      body,
    );
  }
}
