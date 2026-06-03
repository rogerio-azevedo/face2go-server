import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RegistrationsAdminService } from './registrations-admin.service';

@ApiTags('client-registrations')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/registrations')
export class ClientRegistrationsController {
  constructor(private readonly registrationsAdmin: RegistrationsAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Listar cadastros enviados do meu cliente' })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: Record<string, string | undefined>,
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
}
