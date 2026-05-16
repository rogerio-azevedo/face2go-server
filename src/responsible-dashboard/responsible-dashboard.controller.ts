import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
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

  @Get('accesses/snapshot')
  @ApiOperation({
    summary:
      'Proxy da foto de captura do evento (URL deve ser de leitor Intelbras da escola)',
  })
  async accessSnapshot(
    @CurrentUser() user: JwtPayload,
    @Query('url') url: string,
    @Res() res: Response,
  ): Promise<void> {
    const { body, contentType } =
      await this.responsibleDashboardService.proxyAccessSnapshot(user, url);
    res.setHeader('Content-Type', contentType);
    res.send(body);
  }

  @Get('accesses/all')
  @ApiOperation({
    summary:
      'Histórico de acessos de todo o núcleo (responsáveis e alunos com face no household)',
  })
  async listAllHouseholdAccesses(
    @CurrentUser() user: JwtPayload,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(limitStr ?? '10', 10) || 10),
    );
    return this.responsibleDashboardService.listAllHouseholdAccesses(
      user,
      page,
      limit,
    );
  }

  @Get('accesses/peer/:responsibleId')
  @ApiOperation({
    summary:
      'Histórico de acessos de um co-responsável do mesmo núcleo (mesmos alunos)',
  })
  async listHouseholdPeerAccesses(
    @CurrentUser() user: JwtPayload,
    @Param('responsibleId', ParseUUIDPipe) responsibleId: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(limitStr ?? '10', 10) || 10),
    );
    return this.responsibleDashboardService.listAccessesForHouseholdResponsible(
      user,
      responsibleId,
      page,
      limit,
    );
  }

  @Get('me/accesses')
  @ApiOperation({ summary: 'Histórico de acessos faciais do próprio responsável (face cadastrada na escola)' })
  async listOwnAccesses(
    @CurrentUser() user: JwtPayload,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(limitStr ?? '10', 10) || 10),
    );
    return this.responsibleDashboardService.listOwnAccesses(user, page, limit);
  }

  @Get('other-responsibles')
  @ApiOperation({
    summary:
      'Listar outros responsáveis da escola (para autorizar retirada por cadastrado)',
  })
  async listPeerResponsibles(@CurrentUser() user: JwtPayload) {
    return this.responsibleDashboardService.listPeerResponsibles(user);
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
