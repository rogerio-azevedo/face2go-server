import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { FaceSyncService } from './face-sync.service';

@ApiTags('company-face-sync')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('clients/:clientId/faces')
export class CompanyFaceSyncController {
  constructor(private readonly faceSync: FaceSyncService) { }

  @Post(':registrationId/sync')
  @ApiOperation({
    summary:
      'Sincronizar face de um cadastro aprovado com os leitores do cliente',
  })
  async syncOne(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    return this.faceSync.syncApprovedRegistrationForCompany(
      user,
      clientId,
      registrationId,
    );
  }

  @Get('sync-all/progress')
  @ApiOperation({
    summary: 'SSE — progresso da sincronização em lote (token na query aceito)',
  })
  async syncAllProgress(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Res() res: Response,
  ): Promise<void> {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const write = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await this.faceSync.syncAllPendingForCompany(user, clientId, (evt) =>
        write(evt),
      );
    } catch (e: unknown) {
      write({
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      res.end();
    }
  }
}

@ApiTags('client-face-sync')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/faces')
export class ClientFaceSyncController {
  constructor(private readonly faceSync: FaceSyncService) { }

  @Post(':registrationId/sync')
  @ApiOperation({ summary: 'Sincronizar face com os leitores do meu cliente' })
  syncOne(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    return this.faceSync.syncApprovedRegistrationForClientTenant(
      user,
      registrationId,
    );
  }

  @Get('sync-all/progress')
  @ApiOperation({
    summary: 'SSE — progresso da sincronização em lote (token na query)',
  })
  async syncAllProgress(
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const write = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await this.faceSync.syncAllPendingForClientTenant(user, (evt) =>
        write(evt),
      );
    } catch (e: unknown) {
      write({
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      res.end();
    }
  }
}
