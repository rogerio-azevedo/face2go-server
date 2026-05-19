import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  VehiclesService,
  type VehicleDriverOptionDto,
  type VehicleWithDriverRow,
} from './vehicles.service';

@ApiTags('vehicles-school')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator', 'client_admin')
@Controller('clients/:clientId/vehicles')
export class ClientVehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get('driver-options')
  @ApiOperation({
    summary:
      'Listar responsáveis elegíveis como condutores (gestão escola / web)',
  })
  driverOptions(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ): Promise<VehicleDriverOptionDto[]> {
    return this.vehiclesService.listDriverOptionsForCompanyClient(
      user,
      clientId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Listar veículos da escola (LPR)' })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ): Promise<VehicleWithDriverRow[]> {
    return this.vehiclesService.listVehiclesForCompanyClient(user, clientId);
  }

  @Post()
  @ApiOperation({ summary: 'Cadastrar veículo' })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ): Promise<VehicleWithDriverRow> {
    return this.vehiclesService.createVehicleForCompanyClient(
      user,
      clientId,
      body,
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar veículo' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<VehicleWithDriverRow> {
    return this.vehiclesService.updateVehicleForCompanyClient(
      user,
      clientId,
      id,
      body,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover veículo' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.vehiclesService.deleteVehicleForCompanyClient(
      user,
      clientId,
      id,
    );
  }
}
