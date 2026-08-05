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
import { Roles } from '../common/decorators/roles.decorator';
import {
  AddEmergencyCheckinDto,
  CreateEmergencyEventDto,
  ResolveEmergencyEventDto,
  UpdateEmergencyCheckinDto,
} from '../validation/dto/presence-emergency.dto';
import { EmergencyEventsService } from './emergency-events.service';

@ApiTags('emergency-events')
@ApiBearerAuth()
@Controller()
export class EmergencyEventsController {
  constructor(private readonly emergencyEventsService: EmergencyEventsService) {}

  @Post('clients/:clientId/emergency-events')
  @Roles('company_admin', 'company_operator', 'client_admin')
  @ApiOperation({ summary: 'Ativar modo emergência para uma escola' })
  activate(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: CreateEmergencyEventDto,
  ) {
    return this.emergencyEventsService.activate(user, clientId, dto);
  }

  @Get('emergency-events/:eventId')
  @Roles('company_admin', 'company_operator', 'client_admin', 'client_operator')
  @ApiOperation({ summary: 'Detalhe do evento de emergência com chamada' })
  getById(
    @CurrentUser() user: JwtPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.emergencyEventsService.getById(user, eventId);
  }

  @Patch('emergency-events/:eventId/checkins/:checkinId')
  @Roles('company_admin', 'company_operator', 'client_admin')
  @ApiOperation({ summary: 'Atualizar status de uma pessoa na chamada' })
  updateCheckin(
    @CurrentUser() user: JwtPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('checkinId', ParseUUIDPipe) checkinId: string,
    @Body() dto: UpdateEmergencyCheckinDto,
  ) {
    return this.emergencyEventsService.updateCheckin(
      user,
      eventId,
      checkinId,
      dto,
    );
  }

  @Post('emergency-events/:eventId/checkins')
  @Roles('company_admin', 'company_operator', 'client_admin')
  @ApiOperation({ summary: 'Adicionar pessoa manualmente à chamada' })
  addCheckin(
    @CurrentUser() user: JwtPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: AddEmergencyCheckinDto,
  ) {
    return this.emergencyEventsService.addCheckin(user, eventId, dto);
  }

  @Patch('emergency-events/:eventId/resolve')
  @Roles('company_admin', 'company_operator', 'client_admin')
  @ApiOperation({ summary: 'Encerrar evento de emergência' })
  resolve(
    @CurrentUser() user: JwtPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: ResolveEmergencyEventDto,
  ) {
    return this.emergencyEventsService.resolve(user, eventId, dto);
  }
}
