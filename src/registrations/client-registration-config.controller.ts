import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdateRegistrationFieldsConfigDto } from '../validation/dto/registration-config.dto';
import { RegistrationConfigService } from './registration-config.service';

@ApiTags('client-registration-config')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/registration-config')
export class ClientRegistrationConfigController {
  constructor(
    private readonly registrationConfigService: RegistrationConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Ler configuração dos campos do cadastro público do meu cliente',
  })
  get(@CurrentUser() user: JwtPayload) {
    return this.registrationConfigService.getForClientTenant(user);
  }

  @Put()
  @ApiOperation({
    summary: 'Atualizar configuração dos campos do cadastro público',
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Body() body: UpdateRegistrationFieldsConfigDto,
  ) {
    return this.registrationConfigService.updateForClientTenant(user, body);
  }
}
