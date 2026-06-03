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
import { RegistrationLinksService } from './registration-links.service';

@ApiTags('registration-links')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('clients/:clientId/registration-links')
export class CompanyRegistrationLinksController {
  constructor(
    private readonly registrationLinksService: RegistrationLinksService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Gerar link de cadastro para um cliente da empresa',
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ) {
    return this.registrationLinksService.createForCompanyUser(
      user,
      clientId,
      body,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Listar links de cadastro de um cliente' })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.registrationLinksService.listForCompanyUser(user, clientId);
  }

  @Patch(':linkId')
  @ApiOperation({ summary: 'Ativar/desativar um link de cadastro' })
  setActive(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() body: unknown,
  ) {
    return this.registrationLinksService.setActiveForCompanyUser(
      user,
      clientId,
      linkId,
      body,
    );
  }
}
