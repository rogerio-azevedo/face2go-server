import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DeviceSyncQueueService } from '../device-sync-queue/device-sync-queue.service';
import { observeDeviceSyncJobs } from '../device-sync-queue/observe-device-sync-job';
import {
  writeSseHeaders,
  writeSseEvent,
} from '../device-sync-queue/device-sync-sse.util';
import { EnqueueDeviceSyncBodyDto } from '../validation/dto/device-sync-jobs.dto';
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

  @Post('sync-all')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Enfileira sync em lote dos cadastros (não bloqueia)',
  })
  async enqueueSyncAll(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: EnqueueDeviceSyncBodyDto,
  ) {
    const jobIds = await this.faceSync.enqueueAllPendingRegistrations(
      user,
      clientId,
      dto.force,
    );
    return { queued: jobIds.length, force: dto.force === true };
  }

  @Get('sync-status')
  @ApiOperation({
    summary: 'Resumo dos jobs de faces ativos neste cliente (queued/running)',
  })
  getBatchSyncStatus(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.faceSync.getRegistrationSyncAllStatus(user, clientId);
  }

  @Post(':registrationId/sync')
  @ApiOperation({
    summary: 'Enfileirar sync da face de um cadastro aprovado (202 + jobId)',
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
      { resetReaderProgress: true },
    );
  }

  @Get(':registrationId/sync')
  @ApiOperation({
    summary: 'Status do sync facial de um cadastro aprovado',
  })
  async getSyncStatus(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    await this.faceSync.ensureCompanyCanAccessClientPublic(user, clientId);
    return this.faceSync.getApprovedRegistrationSyncStatus(
      registrationId,
      clientId,
    );
  }

  @Get('sync-all/progress')
  @ApiOperation({
    summary:
      'SSE — observa a fila de sync em lote (query force=1 reenvia todos; token na query aceito)',
  })
  @ApiQuery({ name: 'force', required: false })
  async syncAllProgress(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Res() res: Response,
    @Query('force') force?: string,
  ): Promise<void> {
    writeSseHeaders(res);
    try {
      const jobIds = await this.faceSync.enqueueAllPendingRegistrations(
        user,
        clientId,
        force === '1' || force === 'true',
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

  @Post('sync-all')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Enfileira sync em lote dos cadastros (não bloqueia)',
  })
  async enqueueSyncAll(
    @CurrentUser() user: JwtPayload,
    @Body() dto: EnqueueDeviceSyncBodyDto,
  ) {
    const clientId = this.faceSync.ensureClientTenantPublic(user);
    const jobIds = await this.faceSync.enqueueAllPendingRegistrations(
      user,
      clientId,
      dto.force,
    );
    return { queued: jobIds.length, force: dto.force === true };
  }

  @Get('sync-status')
  @ApiOperation({
    summary: 'Resumo dos jobs de faces ativos neste cliente (queued/running)',
  })
  getBatchSyncStatus(@CurrentUser() user: JwtPayload) {
    const clientId = this.faceSync.ensureClientTenantPublic(user);
    return this.faceSync.getRegistrationSyncAllStatus(user, clientId);
  }

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
      { resetReaderProgress: true },
    );
  }

  @Get(':registrationId/sync')
  @ApiOperation({ summary: 'Status do sync facial de um cadastro' })
  getSyncStatus(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
  ) {
    const clientId = this.faceSync.ensureClientTenantPublic(user);
    return this.faceSync.getApprovedRegistrationSyncStatus(
      registrationId,
      clientId,
    );
  }

  @Get('sync-all/progress')
  @ApiOperation({
    summary:
      'SSE — observa a fila de sync em lote (query force=1 reenvia todos; token na query)',
  })
  @ApiQuery({ name: 'force', required: false })
  async syncAllProgress(
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
    @Query('force') force?: string,
  ): Promise<void> {
    writeSseHeaders(res);
    try {
      const clientId = this.faceSync.ensureClientTenantPublic(user);
      const jobIds = await this.faceSync.enqueueAllPendingRegistrations(
        user,
        clientId,
        force === '1' || force === 'true',
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
