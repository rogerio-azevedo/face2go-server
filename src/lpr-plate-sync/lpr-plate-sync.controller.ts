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
import { DeviceSyncQueueService } from '../device-sync-queue/device-sync-queue.service';
import { observeDeviceSyncJobs } from '../device-sync-queue/observe-device-sync-job';
import {
  writeSseEvent,
  writeSseHeaders,
} from '../device-sync-queue/device-sync-sse.util';
import { LprPlateSyncService } from './lpr-plate-sync.service';

@ApiTags('company-lpr-plate-sync')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('clients/:clientId/lpr-plates')
export class CompanyLprPlateSyncController {
  constructor(
    private readonly lprPlateSync: LprPlateSyncService,
    private readonly queue: DeviceSyncQueueService,
  ) {}

  @Post(':vehicleId/sync')
  @ApiOperation({
    summary: 'Enfileirar sync da placa com as câmeras LPR (jobId)',
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
    summary: 'SSE — observa a fila de sync de placas (token na query aceito)',
  })
  async syncAllProgress(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Res() res: Response,
  ): Promise<void> {
    writeSseHeaders(res);
    try {
      const jobIds = await this.lprPlateSync.enqueueAllPendingVehicles(
        user,
        clientId,
      );
      await observeDeviceSyncJobs(this.queue, res, jobIds);
    } catch (e: unknown) {
      writeSseEvent(res, {
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
  constructor(
    private readonly lprPlateSync: LprPlateSyncService,
    private readonly queue: DeviceSyncQueueService,
  ) {}

  @Post(':vehicleId/sync')
  @ApiOperation({ summary: 'Enfileirar sync da placa (jobId)' })
  syncOne(
    @CurrentUser() user: JwtPayload,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
  ) {
    return this.lprPlateSync.syncVehicleForClientTenant(user, vehicleId);
  }

  @Get('sync-all/progress')
  @ApiOperation({
    summary: 'SSE — observa a fila de sync de placas (token na query)',
  })
  async syncAllProgress(
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    writeSseHeaders(res);
    try {
      const clientId = user.clientId ?? '';
      const jobIds = await this.lprPlateSync.enqueueAllPendingVehicles(
        user,
        clientId,
      );
      await observeDeviceSyncJobs(this.queue, res, jobIds);
    } catch (e: unknown) {
      writeSseEvent(res, {
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      res.end();
    }
  }
}
