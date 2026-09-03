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
import { ListRegistrationsQueryDto } from '../validation/dto/registrations.dto';
import { RegistrationsAdminService } from './registrations-admin.service';

@ApiTags('company-registrations')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('clients/:clientId/registrations')
export class CompanyRegistrationsController {
  constructor(private readonly registrationsAdmin: RegistrationsAdminService) {}

  @Get()
  @ApiOperation({
    summary:
      'Listar cadastros enviados de um cliente paginados (?page, ?pageSize, ?status, ?search)',
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query() query: ListRegistrationsQueryDto,
  ) {
    return this.registrationsAdmin.listForCompanyUser(user, clientId, query);
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
}
