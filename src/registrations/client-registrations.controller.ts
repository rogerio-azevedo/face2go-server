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
import {
  BlockRegistrationDto,
  ListRegistrationsQueryDto,
  UpdateRegistrationDto,
} from '../validation/dto/registrations.dto';
import { RegistrationsAdminService } from './registrations-admin.service';

@ApiTags('client-registrations')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/registrations')
export class ClientRegistrationsController {
  constructor(private readonly registrationsAdmin: RegistrationsAdminService) {}

  @Get()
  @ApiOperation({
    summary:
      'Listar cadastros enviados do meu cliente paginados (?page, ?pageSize, ?status, ?search)',
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListRegistrationsQueryDto,
  ) {
    return this.registrationsAdmin.listForClientTenant(user, query);
  }

  @Get(':registrationId/face-url')
  @ApiOperation({ summary: 'URL temporária para visualizar a foto' })
  faceUrl(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    return this.registrationsAdmin.faceUrlForClientTenant(user, registrationId);
  }

  @Post(':registrationId/approve')
  @ApiOperation({ summary: 'Aprovar cadastro (rascunho → aprovado)' })
  approve(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    return this.registrationsAdmin.approveForClientTenant(user, registrationId);
  }

  @Post(':registrationId/block')
  @ApiOperation({
    summary:
      'Bloquear cadastro: envia a face ao leitor no perfil Bloqueados e registra o motivo',
  })
  block(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
    @Body() body: BlockRegistrationDto,
  ) {
    return this.registrationsAdmin.blockForClientTenant(
      user,
      registrationId,
      body,
    );
  }

  @Post(':registrationId/reject')
  @ApiOperation({ summary: 'Rejeitar cadastro' })
  reject(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
    @Body() body: unknown,
  ) {
    return this.registrationsAdmin.rejectForClientTenant(
      user,
      registrationId,
      body,
    );
  }

  @Patch(':registrationId')
  @ApiOperation({ summary: 'Editar cadastro aprovado do meu cliente' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
    @Body() dto: UpdateRegistrationDto,
  ) {
    return this.registrationsAdmin.updateForClientTenant(
      user,
      registrationId,
      dto,
    );
  }

  @Delete(':registrationId')
  @Roles('client_admin')
  @ApiOperation({
    summary:
      'Excluir cadastro aprovado (soft delete) e remover face dos leitores',
  })
  softDelete(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    return this.registrationsAdmin.softDeleteForClientTenant(
      user,
      registrationId,
    );
  }

  @Post(':registrationId/restore')
  @Roles('client_admin')
  @ApiOperation({
    summary: 'Restaurar cadastro excluído e resincronizar face nos leitores',
  })
  restore(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    return this.registrationsAdmin.restoreForClientTenant(user, registrationId);
  }
}
