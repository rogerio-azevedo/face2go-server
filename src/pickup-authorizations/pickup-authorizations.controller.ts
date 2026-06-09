import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Body,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PickupAuthorizationsService } from './pickup-authorizations.service';

@ApiTags('pickup-authorizations')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator', 'client_admin')
@Controller('clients/:clientId/pickup-authorizations')
export class PickupAuthorizationsSchoolController {
  constructor(private readonly svc: PickupAuthorizationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar autorizações temporárias de retirada (escola)',
  })
  @ApiQuery({ name: 'studentId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query('studentId') studentId?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.listForSchoolClient(user, clientId, { studentId, status });
  }

  @Patch(':id/mark-used')
  @ApiOperation({ summary: 'Marcar autorização como utilizada pela portaria' })
  async markUsed(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.markUsedForSchool(user, clientId, id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancelar autorização (escola)' })
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.cancelForSchool(user, clientId, id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Excluir autorização cancelada ou expirada (escola)',
  })
  delete(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.deleteForSchool(user, clientId, id);
  }
}

@ApiTags('pickup-authorizations-responsible')
@ApiBearerAuth()
@Roles('responsible')
@Controller('responsible')
export class PickupAuthorizationsResponsibleController {
  constructor(private readonly svc: PickupAuthorizationsService) {}

  @Get('pickup-authorizations')
  @ApiOperation({
    summary: 'Listar minhas autorizações temporárias de retirada',
  })
  listMine(@CurrentUser() user: JwtPayload) {
    return this.svc.listForResponsible(user);
  }

  @Get('lookup-guest-responsible')
  @ApiOperation({
    summary: 'Buscar responsável cadastrado pelo documento (CPF)',
  })
  @ApiQuery({ name: 'document', required: true })
  lookupGuestResponsible(
    @CurrentUser() user: JwtPayload,
    @Query('document') document: string,
  ) {
    return this.svc.lookupGuestResponsible(user, document);
  }

  @Post('pickup-authorizations')
  @ApiOperation({ summary: 'Criar autorização temporária de retirada' })
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.svc.createFromResponsible(user, body);
  }

  @Patch('pickup-authorizations/:id')
  @ApiOperation({ summary: 'Editar ou renovar autorização temporária' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.updateForResponsible(user, id, body);
  }

  @Delete('pickup-authorizations/:id')
  @ApiOperation({
    summary: 'Excluir autorização cancelada ou expirada',
  })
  delete(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.deleteForResponsible(user, id);
  }

  @Post('pickup-authorizations/:id/guest-link')
  @ApiOperation({ summary: 'Gerar link de cadastro de face do convidado' })
  generateGuestLink(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.generateGuestLink(user, id);
  }

  @Get('pickup-authorizations/:id/guest-face-url')
  @ApiOperation({ summary: 'URL assinada da foto enviada pelo convidado' })
  guestFaceUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.getGuestFacePreviewUrl(user, id);
  }

  @Post('pickup-authorizations/:id/guest-face')
  @ApiOperation({
    summary:
      'Enviar face do convidado presencialmente e aprovar automaticamente',
  })
  submitGuestFace(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.submitGuestFaceDirect(user, id, body);
  }

  @Post('pickup-authorizations/:id/approve-guest-face')
  @ApiOperation({
    summary: 'Aprovar face do convidado e sincronizar leitores/LPR',
  })
  approveGuestFace(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.approveGuestFace(user, id);
  }

  @Post('pickup-authorizations/:id/reject-guest-face')
  @ApiOperation({ summary: 'Recusar face do convidado' })
  rejectGuestFace(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.rejectGuestFace(user, id);
  }

  @Patch('pickup-authorizations/:id/cancel')
  @ApiOperation({ summary: 'Cancelar minha autorização ativa' })
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.cancelForResponsible(user, id);
  }
}
