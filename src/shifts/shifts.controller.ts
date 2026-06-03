import {
  Body,
  Controller,
  Delete,
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
import { ShiftsService } from './shifts.service';

@ApiTags('shifts')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator', 'client_admin')
@Controller('clients/:clientId/shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar turnos de acesso do cliente' })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.shiftsService.list(user, clientId);
  }

  @Get(':shiftId')
  @ApiOperation({ summary: 'Detalhe do turno' })
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
  ) {
    return this.shiftsService.getById(user, clientId, shiftId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar turno' })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ) {
    return this.shiftsService.create(user, clientId, body);
  }

  @Patch(':shiftId')
  @ApiOperation({ summary: 'Atualizar turno' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
    @Body() body: unknown,
  ) {
    return this.shiftsService.update(user, clientId, shiftId, body);
  }

  @Delete(':shiftId')
  @ApiOperation({ summary: 'Remover turno' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
  ) {
    return this.shiftsService.remove(user, clientId, shiftId);
  }
}
