import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ResponsibleDashboardService } from './responsible-dashboard.service';

@ApiTags('responsible-dashboard')
@ApiBearerAuth()
@Roles('responsible')
@Controller('responsible')
export class ResponsibleDashboardController {
  constructor(
    private readonly responsibleDashboardService: ResponsibleDashboardService,
  ) {}

  @Get('children')
  @ApiOperation({ summary: 'Listar filhos vinculados ao responsável (app)' })
  async listChildren(@CurrentUser() user: JwtPayload) {
    return this.responsibleDashboardService.listChildren(user);
  }

  @Get('children/:studentId/accesses')
  @ApiOperation({ summary: 'Histórico de acessos faciais do aluno vinculado' })
  async listAccesses(
    @CurrentUser() user: JwtPayload,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(limitStr ?? '10', 10) || 10),
    );
    return this.responsibleDashboardService.listAccessesForLinkedStudent(
      user,
      studentId,
      page,
      limit,
    );
  }
}
