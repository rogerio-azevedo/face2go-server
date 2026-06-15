import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { MemberPortalService } from './member-portal.service';

@ApiTags('member-portal')
@ApiBearerAuth()
@Roles('member')
@Controller('member')
export class MemberPortalController {
  constructor(private readonly memberPortalService: MemberPortalService) {}

  @Get('me')
  @ApiOperation({ summary: 'Perfil do membro autenticado (app)' })
  getMe(@CurrentUser() user: JwtPayload) {
    return this.memberPortalService.getMe(user);
  }

  @Get('accesses')
  @ApiOperation({
    summary: 'Histórico de acessos faciais do membro autenticado',
  })
  listAccesses(
    @CurrentUser() user: JwtPayload,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(limitStr ?? '10', 10) || 10),
    );
    return this.memberPortalService.listAccesses(user, page, limit);
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
      await this.memberPortalService.proxyAccessSnapshot(user, url);
    res.setHeader('Content-Type', contentType);
    res.send(body);
  }
}
