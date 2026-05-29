import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Body,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ManagedResponsiblesService } from './managed-responsibles.service';

@ApiTags('managed-responsibles')
@ApiBearerAuth()
@Roles('responsible')
@Controller('responsible')
export class ManagedResponsiblesController {
  constructor(private readonly svc: ManagedResponsiblesService) {}

  @Post('managed-responsibles')
  @ApiOperation({ summary: 'Cadastrar responsável presencialmente (Fluxo 1)' })
  createManaged(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.svc.createManagedResponsible(user, body);
  }

  @Get('managed-responsibles')
  @ApiOperation({ summary: 'Listar responsáveis do núcleo familiar' })
  listManaged(@CurrentUser() user: JwtPayload) {
    return this.svc.listManagedResponsibles(user);
  }

  @Post('responsible-invitations')
  @ApiOperation({ summary: 'Criar convite de cadastro de responsável (Fluxo 2)' })
  createInvitation(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.svc.createInvitation(user, body);
  }

  @Get('responsible-invitations')
  @ApiOperation({ summary: 'Listar convites de cadastro de responsável' })
  listInvitations(@CurrentUser() user: JwtPayload) {
    return this.svc.listInvitations(user);
  }

  @Get('responsible-invitations/:id/face-url')
  @ApiOperation({ summary: 'URL assinada da foto enviada pelo convidado' })
  faceUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.getInvitationFaceUrl(user, id);
  }

  @Post('responsible-invitations/:id/approve-face')
  @ApiOperation({ summary: 'Aprovar face do convidado' })
  approveFace(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.approveFace(user, id);
  }

  @Post('responsible-invitations/:id/reject-face')
  @ApiOperation({ summary: 'Recusar face do convidado' })
  rejectFace(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.rejectFace(user, id);
  }

  @Post('responsible-invitations/:id/approve-plate')
  @ApiOperation({ summary: 'Aprovar placa do convidado' })
  approvePlate(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.approvePlate(user, id);
  }

  @Post('responsible-invitations/:id/reject-plate')
  @ApiOperation({ summary: 'Recusar placa do convidado' })
  rejectPlate(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.rejectPlate(user, id);
  }

  @Patch('responsible-invitations/:id/cancel')
  @ApiOperation({ summary: 'Cancelar convite pendente' })
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.cancelInvitation(user, id);
  }
}
