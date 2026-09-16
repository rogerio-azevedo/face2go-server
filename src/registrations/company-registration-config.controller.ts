import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdateRegistrationFieldsConfigDto } from '../validation/dto/registration-config.dto';
import { RegistrationConfigService } from './registration-config.service';

@ApiTags('registration-config')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('clients/:clientId/registration-config')
export class CompanyRegistrationConfigController {
  constructor(
    private readonly registrationConfigService: RegistrationConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Ler configuração dos campos do cadastro público',
  })
  get(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.registrationConfigService.getForCompanyUser(user, clientId);
  }

  @Put()
  @ApiOperation({
    summary: 'Atualizar configuração dos campos do cadastro público',
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: UpdateRegistrationFieldsConfigDto,
  ) {
    return this.registrationConfigService.updateForCompanyUser(
      user,
      clientId,
      body,
    );
  }
}
