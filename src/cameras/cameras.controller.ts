import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CamerasService } from './cameras.service';

@ApiTags('cameras')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('cameras')
export class CamerasController {
  constructor(private readonly camerasService: CamerasService) {}

  @Get('monitor/status')
  @ApiOperation({
    summary:
      'Status das câmeras LPR Intelbras — eventManager/snapManager (digest HTTP)',
  })
  monitorStatus(
    @CurrentUser() user: JwtPayload,
    @Query('clientId') clientId?: string,
  ) {
    return this.camerasService.getMonitorStatus(user, clientId);
  }

  @Get(':cameraId/device-plates')
  @ApiOperation({
    summary:
      'Listar placas cadastradas na câmera LPR Intelbras (TrafficRedList)',
  })
  getDevicePlates(
    @CurrentUser() user: JwtPayload,
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('search') search?: string,
  ) {
    const lim = limit ? parseInt(limit, 10) : 50;
    const off = offset ? parseInt(offset, 10) : 0;
    const term = search?.trim() || undefined;
    return this.camerasService.getDevicePlates(
      user,
      cameraId,
      lim,
      off,
      term,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Listar câmeras da empresa' })
  list(
    @CurrentUser() user: JwtPayload,
    @Query('clientId') clientId?: string,
  ) {
    return this.camerasService.list(user, clientId);
  }

  @Post()
  @ApiOperation({
    summary: 'Cadastrar câmera (apenas admin da empresa)',
  })
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.camerasService.create(user, body);
  }

  @Patch(':cameraId/active')
  @ApiOperation({
    summary: 'Ativar/desativar câmera (apenas admin da empresa)',
  })
  setActive(
    @CurrentUser() user: JwtPayload,
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
    @Body() body: unknown,
  ) {
    return this.camerasService.setActive(user, cameraId, body);
  }

  @Patch(':cameraId')
  @ApiOperation({
    summary: 'Atualizar câmera (apenas admin da empresa)',
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
    @Body() body: unknown,
  ) {
    return this.camerasService.update(user, cameraId, body);
  }
}
