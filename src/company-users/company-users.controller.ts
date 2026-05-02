import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CompanyUsersService } from './company-users.service';

@ApiTags('company-users')
@ApiBearerAuth()
@Roles('company_admin')
@Controller('company-users')
export class CompanyUsersController {
  constructor(private readonly companyUsersService: CompanyUsersService) {}

  @Get()
  @ApiOperation({
    summary:
      'Listar usuários da empresa com mapa de permissões por operador',
  })
  list(@CurrentUser() user: JwtPayload) {
    return this.companyUsersService.listWithPermissions(user);
  }

  @Patch(':companyUserId/role')
  @ApiOperation({ summary: 'Alterar papel do colaborador' })
  updateRole(
    @CurrentUser() user: JwtPayload,
    @Param('companyUserId', ParseUUIDPipe) companyUserId: string,
    @Body() body: unknown,
  ) {
    return this.companyUsersService.updateRole(user, companyUserId, body);
  }

  @Patch(':companyUserId/active')
  @ApiOperation({ summary: 'Ativar/desativar colaborador' })
  setActive(
    @CurrentUser() user: JwtPayload,
    @Param('companyUserId', ParseUUIDPipe) companyUserId: string,
    @Body() body: unknown,
  ) {
    return this.companyUsersService.setActive(user, companyUserId, body);
  }

  @Patch(':companyUserId/profile')
  @ApiOperation({ summary: 'Atualizar nome exibido e dados do vínculo' })
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Param('companyUserId', ParseUUIDPipe) companyUserId: string,
    @Body() body: unknown,
  ) {
    return this.companyUsersService.updateProfile(
      user,
      companyUserId,
      body,
    );
  }

  @Patch(':companyUserId/permissions')
  @ApiOperation({ summary: 'Permissões granulares por módulo (operadores)' })
  updatePermissions(
    @CurrentUser() user: JwtPayload,
    @Param('companyUserId', ParseUUIDPipe) companyUserId: string,
    @Body() body: unknown,
  ) {
    return this.companyUsersService.updatePermissions(
      user,
      companyUserId,
      body,
    );
  }
}
