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
import { VehiclesService } from './vehicles.service';

@ApiTags('vehicles-responsible')
@ApiBearerAuth()
@Roles('responsible')
@Controller('responsible')
export class VehiclesResponsibleController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get('vehicles/driver-options')
  @ApiOperation({
    summary:
      'Listar responsáveis que podem ser condutores (você e co-responsáveis pelos mesmos alunos)',
  })
  driverOptions(@CurrentUser() user: JwtPayload) {
    return this.vehiclesService.listDriverOptions(user);
  }

  @Get('vehicles')
  @ApiOperation({ summary: 'Listar veículos cadastrados pelo responsável' })
  list(@CurrentUser() user: JwtPayload) {
    return this.vehiclesService.listForResponsible(user);
  }

  @Post('vehicles')
  @ApiOperation({ summary: 'Cadastrar veículo (LPR / escola)' })
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.vehiclesService.createFromResponsible(user, body);
  }

  @Patch('vehicles/:id')
  @ApiOperation({
    summary: 'Atualizar veículo (condutor, placa, marca, modelo, cor)',
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.vehiclesService.updateFromResponsible(user, id, body);
  }

  @Post('vehicles/:id/sync')
  @ApiOperation({
    summary: 'Sincronizar placa do veículo com as câmeras LPR Intelbras',
  })
  sync(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vehiclesService.syncForResponsible(user, id);
  }

  @Delete('vehicles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover veículo cadastrado' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vehiclesService.deleteForResponsible(user, id);
  }
}
