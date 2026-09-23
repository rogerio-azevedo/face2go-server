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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  BlockRegistrationDto,
  ExportRegistrationsQueryDto,
  ListRegistrationsQueryDto,
  UpdateRegistrationDto,
} from '../validation/dto/registrations.dto';
import { RegistrationsAdminService } from './registrations-admin.service';
import { RegistrationFaceRetakeService } from './registration-face-retake.service';

@ApiTags('company-registrations')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('clients/:clientId/registrations')
export class CompanyRegistrationsController {
  constructor(
    private readonly registrationsAdmin: RegistrationsAdminService,
    private readonly faceRetake: RegistrationFaceRetakeService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Listar cadastros enviados de um cliente paginados (?page, ?pageSize, ?status, ?search, ?block, ?unit, ?room)',
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query() query: ListRegistrationsQueryDto,
  ) {
    return this.registrationsAdmin.listForCompanyUser(user, clientId, query);
  }

  @Get('export')
  @ApiOperation({
    summary: 'Exportar cadastros enviados de um cliente em Excel',
  })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  exportXlsx(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query() query: ExportRegistrationsQueryDto,
  ) {
    return this.registrationsAdmin.exportXlsxForCompanyUser(
      user,
      clientId,
      query,
    );
  }

  @Get(':registrationId/face-url')
  @ApiOperation({ summary: 'URL temporária para visualizar a foto' })
  faceUrl(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    return this.registrationsAdmin.faceUrlForCompanyUser(
      user,
      clientId,
      registrationId,
    );
  }

  @Post(':registrationId/approve')
  @ApiOperation({ summary: 'Aprovar cadastro' })
  approve(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    return this.registrationsAdmin.approveForCompanyUser(
      user,
      clientId,
      registrationId,
    );
  }

  @Post(':registrationId/block')
  @ApiOperation({
    summary:
      'Bloquear cadastro: envia a face ao leitor no perfil Bloqueados e registra o motivo',
  })
  block(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
    @Body() body: BlockRegistrationDto,
  ) {
    return this.registrationsAdmin.blockForCompanyUser(
      user,
      clientId,
      registrationId,
      body,
    );
  }

  @Post(':registrationId/unblock')
  @ApiOperation({
    summary:
      'Desbloquear cadastro: restaura status aprovado e reenvia a face ao leitor com acesso normal',
  })
  unblock(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    return this.registrationsAdmin.unblockForCompanyUser(
      user,
      clientId,
      registrationId,
    );
  }

  @Post(':registrationId/reject')
  @ApiOperation({ summary: 'Rejeitar cadastro' })
  reject(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
    @Body() body: unknown,
  ) {
    return this.registrationsAdmin.rejectForCompanyUser(
      user,
      clientId,
      registrationId,
      body,
    );
  }

  @Patch(':registrationId')
  @ApiOperation({ summary: 'Editar cadastro' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
    @Body() dto: UpdateRegistrationDto,
  ) {
    return this.registrationsAdmin.updateForCompanyUser(
      user,
      clientId,
      registrationId,
      dto,
    );
  }

  @Delete(':registrationId')
  @Roles('company_admin')
  @ApiOperation({
    summary:
      'Excluir cadastro aprovado (soft delete) e remover face dos leitores',
  })
  softDelete(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    return this.registrationsAdmin.softDeleteForCompanyUser(
      user,
      clientId,
      registrationId,
    );
  }

  @Post(':registrationId/restore')
  @Roles('company_admin')
  @ApiOperation({
    summary: 'Restaurar cadastro excluído e resincronizar face nos leitores',
  })
  restore(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    return this.registrationsAdmin.restoreForCompanyUser(
      user,
      clientId,
      registrationId,
    );
  }

  @Post(':registrationId/face-retake-link')
  @ApiOperation({
    summary: 'Gerar link de uso único para a pessoa refazer a foto',
  })
  createFaceRetakeLink(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    return this.faceRetake.createForCompanyUser(user, clientId, registrationId);
  }
}
