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

@ApiTags('vehicles-member')
@ApiBearerAuth()
@Roles('member')
@Controller('member')
export class VehiclesMemberController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get('vehicles')
  @ApiOperation({ summary: 'Listar veículos cadastrados pelo membro' })
  list(@CurrentUser() user: JwtPayload) {
    return this.vehiclesService.listForMember(user);
  }

  @Post('vehicles')
  @ApiOperation({ summary: 'Cadastrar veículo (LPR)' })
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.vehiclesService.createFromMember(user, body);
  }

  @Patch('vehicles/:id')
  @ApiOperation({ summary: 'Atualizar veículo (placa, marca, modelo, cor)' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.vehiclesService.updateFromMember(user, id, body);
  }

  @Post('vehicles/:id/sync')
  @ApiOperation({
    summary: 'Sincronizar placa do veículo com as câmeras LPR Intelbras',
  })
  sync(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vehiclesService.syncForMember(user, id);
  }

  @Delete('vehicles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover veículo cadastrado' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vehiclesService.deleteForMember(user, id);
  }
}
