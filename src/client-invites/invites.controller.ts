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
import { InvitesService } from './invites.service';

@ApiTags('invites-client')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator', 'client_admin')
@Controller('clients/:clientId/invites')
export class InvitesClientController {
  constructor(private readonly svc: InvitesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar convites de visitantes (painel web)' })
  @ApiQuery({ name: 'status', required: false })
  async list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query('status') status?: string,
  ) {
    return this.svc.listForClient(user, clientId, { status });
  }

  @Patch(':id/mark-used')
  @ApiOperation({ summary: 'Marcar convite como utilizado' })
  async markUsed(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.markUsedForClient(user, clientId, id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancelar convite (painel web)' })
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.cancelForClient(user, clientId, id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Excluir convite cancelado, expirado ou utilizado',
  })
  delete(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.deleteForClient(user, clientId, id);
  }
}

@ApiTags('invites-member')
@ApiBearerAuth()
@Roles('member')
@Controller('member')
export class InvitesMemberController {
  constructor(private readonly svc: InvitesService) {}

  @Get('invites')
  @ApiOperation({ summary: 'Listar meus convites de visitantes' })
  listMine(@CurrentUser() user: JwtPayload) {
    return this.svc.listForMember(user);
  }

  @Post('invites')
  @ApiOperation({ summary: 'Criar convite de visitante' })
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.svc.createFromMember(user, body);
  }

  @Patch('invites/:id')
  @ApiOperation({ summary: 'Editar ou renovar convite de visitante' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.updateForMember(user, id, body);
  }

  @Delete('invites/:id')
  @ApiOperation({
    summary: 'Excluir convite cancelado, expirado ou utilizado',
  })
  delete(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.deleteForMember(user, id);
  }

  @Post('invites/:id/guest-link')
  @ApiOperation({ summary: 'Gerar link de cadastro de face do visitante' })
  generateGuestLink(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.generateGuestLink(user, id);
  }

  @Get('invites/:id/guest-face-url')
  @ApiOperation({ summary: 'URL assinada da foto enviada pelo visitante' })
  guestFaceUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.getGuestFacePreviewUrl(user, id);
  }

  @Post('invites/:id/guest-face')
  @ApiOperation({
    summary:
      'Enviar face do visitante presencialmente e aprovar automaticamente',
  })
  submitGuestFace(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.submitGuestFaceDirect(user, id, body);
  }

  @Post('invites/:id/approve-guest-face')
  @ApiOperation({
    summary: 'Aprovar face do visitante e sincronizar leitores/LPR',
  })
  approveGuestFace(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.approveGuestFace(user, id);
  }

  @Post('invites/:id/reject-guest-face')
  @ApiOperation({ summary: 'Recusar face do visitante' })
  rejectGuestFace(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.rejectGuestFace(user, id);
  }

  @Patch('invites/:id/cancel')
  @ApiOperation({ summary: 'Cancelar meu convite ativo' })
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.cancelForMember(user, id);
  }
}
