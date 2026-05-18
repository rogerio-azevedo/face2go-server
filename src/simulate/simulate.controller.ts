import {
  Body,
  Controller,
  Get,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

import { SimulateFaceAccessDto } from './simulate.dto';
import { SimulateService } from './simulate.service';

@ApiTags('simulate')
@ApiBearerAuth()
@Roles('company_admin', 'super_admin')
@Controller('simulate')
export class SimulateController {
  constructor(private readonly simulateService: SimulateService) {}

  @Get('people')
  @ApiOperation({
    summary:
      '[Dev] Lista alunos e responsáveis com indicador se possuem faceId (para simular acesso)',
  })
  people(
    @CurrentUser() user: JwtPayload,
    @Query('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.simulateService.listPeople(user, clientId);
  }

  @Post('face-access')
  @ApiOperation({
    summary: '[Dev] Simula uma detecção facial (persiste accesso + notificações + SSE)',
  })
  faceAccess(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SimulateFaceAccessDto,
  ) {
    return this.simulateService.simulateFaceAccess(user, dto);
  }
}
