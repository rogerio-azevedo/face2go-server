import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Body,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateManagedResponsibleDto,
  CreateManagedResponsibleInvitationDto,
} from '../validation/dto/managed-responsibles.dto';
import { ManagedResponsiblesService } from './managed-responsibles.service';

@ApiTags('managed-responsibles')
@ApiBearerAuth()
@Roles('responsible')
@Controller('responsible')
export class ManagedResponsiblesController {
  constructor(private readonly svc: ManagedResponsiblesService) {}

  @Post('managed-responsibles')
  @ApiOperation({ summary: 'Cadastrar responsável presencialmente (Fluxo 1)' })
  createManaged(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateManagedResponsibleDto,
  ) {
    return this.svc.createManagedResponsible(user, body);
  }

  @Get('managed-responsibles')
  @ApiOperation({ summary: 'Listar responsáveis do núcleo familiar' })
  listManaged(@CurrentUser() user: JwtPayload) {
    return this.svc.listManagedResponsibles(user);
  }

  @Delete('managed-responsibles/:id')
  @ApiOperation({
    summary: 'Excluir responsável do núcleo familiar (apenas pai/mãe)',
  })
  deleteManaged(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.deleteManagedResponsible(user, id);
  }

  @Post('responsible-invitations')
  @ApiOperation({
    summary: 'Criar convite de cadastro de responsável (Fluxo 2)',
  })
  createInvitation(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateManagedResponsibleInvitationDto,
  ) {
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
  @ApiOperation({ summary: 'Aprovar cadastro do convidado (face e veículo)' })
  approveFace(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.approveFace(user, id);
  }

  @Post('responsible-invitations/:id/reject-face')
  @ApiOperation({ summary: 'Recusar cadastro do convidado' })
  rejectFace(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.rejectFace(user, id);
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
