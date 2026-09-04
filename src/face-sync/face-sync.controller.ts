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
import { writeSseHeaders, writeSseEvent } from '../device-sync-queue/device-sync-sse.util';
import { FaceSyncService } from './face-sync.service';

@ApiTags('company-face-sync')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('clients/:clientId/faces')
export class CompanyFaceSyncController {
  constructor(
    private readonly faceSync: FaceSyncService,
    private readonly queue: DeviceSyncQueueService,
  ) {}

  @Post(':registrationId/sync')
  @ApiOperation({
    summary:
      'Enfileirar sync da face de um cadastro aprovado (202 + jobId)',
  })
  async syncOne(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    await this.faceSync.ensureCompanyCanAccessClientPublic(user, clientId);
    return this.faceSync.enqueueApprovedRegistrationJob(
      registrationId,
      clientId,
      user.sub,
    );
  }

  @Get('sync-all/progress')
  @ApiOperation({
    summary: 'SSE — observa a fila de sync em lote (token na query aceito)',
  })
  async syncAllProgress(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Res() res: Response,
  ): Promise<void> {
    writeSseHeaders(res);
    try {
      const jobIds = await this.faceSync.enqueueAllPendingRegistrations(
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

@ApiTags('client-face-sync')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/faces')
export class ClientFaceSyncController {
  constructor(
    private readonly faceSync: FaceSyncService,
    private readonly queue: DeviceSyncQueueService,
  ) {}

  @Post(':registrationId/sync')
  @ApiOperation({ summary: 'Enfileirar sync da face (202 + jobId)' })
  syncOne(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    const clientId = this.faceSync.ensureClientTenantPublic(user);
    return this.faceSync.enqueueApprovedRegistrationJob(
      registrationId,
      clientId,
      user.sub,
    );
  }

  @Get('sync-all/progress')
  @ApiOperation({
    summary: 'SSE — observa a fila de sync em lote (token na query)',
  })
  async syncAllProgress(
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    writeSseHeaders(res);
    try {
      const clientId = this.faceSync.ensureClientTenantPublic(user);
      const jobIds = await this.faceSync.enqueueAllPendingRegistrations(
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
