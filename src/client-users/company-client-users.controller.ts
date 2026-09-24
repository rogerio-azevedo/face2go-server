import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  PatchClientUserActiveDto,
  PatchClientUserPasswordDto,
  PatchClientUserProfileDto,
  PatchClientUserRoleDto,
} from '../validation/dto/client-users.dto';
import { ClientUsersService } from './client-users.service';

@ApiTags('clients')
@ApiBearerAuth()
@Roles('company_admin')
@Controller('clients/:clientId/client-users')
export class CompanyClientUsersController {
  constructor(private readonly clientUsersService: ClientUsersService) {}

  @Patch(':clientUserId/profile')
  @ApiOperation({ summary: 'Atualizar nome e e-mail do usuário do cliente' })
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('clientUserId', ParseUUIDPipe) clientUserId: string,
    @Body() body: PatchClientUserProfileDto,
  ) {
    return this.clientUsersService.updateProfile(
      user,
      clientId,
      clientUserId,
      body,
    );
  }

  @Patch(':clientUserId/role')
  @ApiOperation({ summary: 'Alterar papel do usuário do cliente' })
  updateRole(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('clientUserId', ParseUUIDPipe) clientUserId: string,
    @Body() body: PatchClientUserRoleDto,
  ) {
    return this.clientUsersService.updateRole(
      user,
      clientId,
      clientUserId,
      body,
    );
  }

  @Patch(':clientUserId/active')
  @ApiOperation({ summary: 'Ativar/desativar usuário do cliente' })
  setActive(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('clientUserId', ParseUUIDPipe) clientUserId: string,
    @Body() body: PatchClientUserActiveDto,
  ) {
    return this.clientUsersService.setActive(
      user,
      clientId,
      clientUserId,
      body,
    );
  }

  @Patch(':clientUserId/password')
  @ApiOperation({ summary: 'Definir nova senha do usuário do cliente' })
  setPassword(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('clientUserId', ParseUUIDPipe) clientUserId: string,
    @Body() body: PatchClientUserPasswordDto,
  ) {
    return this.clientUsersService.setPassword(
      user,
      clientId,
      clientUserId,
      body,
    );
  }
}
