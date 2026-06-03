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
import { LprPlateSyncService } from './lpr-plate-sync.service';

@ApiTags('company-lpr-plate-sync')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('clients/:clientId/lpr-plates')
export class CompanyLprPlateSyncController {
  constructor(private readonly lprPlateSync: LprPlateSyncService) {}

  @Post(':vehicleId/sync')
  @ApiOperation({
    summary:
      'Sincronizar placa do veículo com as câmeras LPR Intelbras do cliente',
  })
  syncOne(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
  ) {
    return this.lprPlateSync.syncVehicleForCompany(user, clientId, vehicleId);
  }

  @Get('sync-all/progress')
  @ApiOperation({
    summary:
      'SSE — progresso da sincronização em lote de placas LPR (token na query aceito)',
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
      await this.lprPlateSync.syncAllPendingForCompany(user, clientId, (evt) =>
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

@ApiTags('client-lpr-plate-sync')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/lpr-plates')
export class ClientLprPlateSyncController {
  constructor(private readonly lprPlateSync: LprPlateSyncService) {}

  @Post(':vehicleId/sync')
  @ApiOperation({
    summary: 'Sincronizar placa com as câmeras LPR Intelbras do meu cliente',
  })
  syncOne(
    @CurrentUser() user: JwtPayload,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
  ) {
    return this.lprPlateSync.syncVehicleForClientTenant(user, vehicleId);
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
      await this.lprPlateSync.syncAllPendingForClientTenant(user, (evt) =>
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
