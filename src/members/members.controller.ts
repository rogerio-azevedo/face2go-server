import {
  Body,
  Controller,
  Delete,
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
import { MembersService } from './members.service';

@ApiTags('members')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator', 'client_admin')
@Controller('clients/:clientId')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get('roles')
  @ApiOperation({ summary: 'Listar funções (roles) do cliente' })
  listRoles(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.membersService.listRoles(user, clientId);
  }

  @Post('roles')
  @ApiOperation({ summary: 'Criar função (role) do cliente' })
  createRole(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ) {
    return this.membersService.createRole(user, clientId, body);
  }

  @Patch('roles/:roleId')
  @ApiOperation({ summary: 'Atualizar função (role) do cliente' })
  updateRole(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() body: unknown,
  ) {
    return this.membersService.updateRole(user, clientId, roleId, body);
  }

  @Get('members')
  @ApiOperation({
    summary:
      'Listar membros do cliente paginados (?page, ?pageSize, ?search, ?roleId)',
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('roleId') roleId?: string,
  ) {
    return this.membersService.list(user, clientId, {
      page: page !== undefined ? Number(page) : undefined,
      pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
      search,
      roleId,
    });
  }

  @Get('members/lookup')
  @ApiOperation({
    summary: 'Buscar pessoa existente por CPF ou e-mail antes do cadastro',
  })
  lookupMember(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query('cpf') cpf?: string,
    @Query('email') email?: string,
  ) {
    return this.membersService.lookupPerson(user, clientId, { cpf, email });
  }

  @Post('members')
  @ApiOperation({ summary: 'Cadastrar membro com login (usuário + senha)' })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ) {
    return this.membersService.create(user, clientId, body);
  }

  @Get('members/:memberId')
  @ApiOperation({ summary: 'Detalhe do membro' })
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.membersService.getById(user, clientId, memberId);
  }

  @Patch('members/:memberId')
  @ApiOperation({ summary: 'Atualizar membro (opcional: nova senha)' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() body: unknown,
  ) {
    return this.membersService.update(user, clientId, memberId, body);
  }

  @Delete('members/:memberId')
  @Roles('company_admin')
  @ApiOperation({
    summary: 'Excluir membro (remove face, veículos e vínculos)',
  })
  deleteMember(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.membersService.delete(user, clientId, memberId);
  }

  @Post('members/:memberId/face/sync')
  @ApiOperation({
    summary: 'Sincronizar face do membro com os leitores Intelbras',
  })
  syncFace(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.membersService.syncFaceByCompany(user, clientId, memberId);
  }
}
