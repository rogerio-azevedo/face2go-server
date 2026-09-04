import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { EnqueueDeviceSyncBodyDto } from '../validation/dto/device-sync-jobs.dto';
import {
  BatchDeleteDeviceUsersDto,
  RemoveDeviceUserOrphansDto,
} from '../validation/dto/readers.dto';
import { DeviceSyncQueueService } from '../device-sync-queue/device-sync-queue.service';
import { observeDeviceSyncJob } from '../device-sync-queue/observe-device-sync-job';
import {
  writeSseEvent,
  writeSseHeaders,
} from '../device-sync-queue/device-sync-sse.util';
import { ReadersDeviceUsersService } from './readers-device-users.service';
import { ReadersDeviceWipeSyncService } from './readers-device-wipe-sync.service';

@ApiTags('readers')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('readers')
export class ReadersDeviceUsersController {
  constructor(
    private readonly deviceUsers: ReadersDeviceUsersService,
    private readonly wipeSync: ReadersDeviceWipeSyncService,
    private readonly queue: DeviceSyncQueueService,
  ) {}

  @Get(':readerId/device-users')
  @ApiOperation({
    summary: 'Listar usuários cadastrados no dispositivo (direto da memória)',
  })
  getDeviceUsers(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('search') search?: string,
  ) {
    const lim = limit ? parseInt(limit, 10) : 50;
    const off = offset ? parseInt(offset, 10) : 0;
    return this.deviceUsers.getDeviceUsers(
      user,
      readerId,
      lim,
      off,
      search?.trim() || undefined,
    );
  }

  @Post(':readerId/device-users/batch-delete')
  @ApiOperation({
    summary: 'Remover vários usuários da memória do dispositivo',
  })
  batchDeleteDeviceUsers(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Body() dto: BatchDeleteDeviceUsersDto,
  ) {
    return this.deviceUsers.batchDeleteDeviceUsers(user, readerId, dto.userIds);
  }

  @Post(':readerId/device-users/remove-orphans')
  @ApiOperation({
    summary:
      'Remover do leitor os usuários que não existem no Face2Go (órfãos)',
  })
  removeOrphans(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Body() dto: RemoveDeviceUserOrphansDto,
  ) {
    return this.deviceUsers.removeOrphans(user, readerId, dto.dryRun ?? false);
  }

  @Post(':readerId/device-users/wipe-all')
  @ApiOperation({
    summary:
      'Apagar todos os usuários da memória deste leitor (clientes não-escola)',
  })
  wipeAll(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
  ) {
    return this.wipeSync.wipeAll(user, readerId);
  }

  @Get(':readerId/device-users/sync-status')
  @ApiOperation({
    summary: 'Jobs de sync de faces ativos neste cliente (queued/running)',
  })
  getSyncStatus(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
  ) {
    return this.wipeSync.getFaceReaderSyncStatus(user, readerId);
  }

  @Post(':readerId/device-users/sync-all')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Enfileira sync neste leitor e devolve o job (não bloqueia)',
  })
  enqueueSyncAll(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Body() dto: EnqueueDeviceSyncBodyDto,
  ) {
    return this.wipeSync.enqueueSyncAllOnReader(user, readerId, dto.force);
  }

  @Get(':readerId/device-users/sync-all/progress')
  @ApiOperation({
    summary:
      'SSE — observa sync neste leitor (query force=1 reenvia todos; token na query aceito)',
  })
  async syncAllProgress(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Res() res: Response,
    @Query('force') force?: string,
  ): Promise<void> {
    writeSseHeaders(res);
    try {
      const job = await this.wipeSync.enqueueSyncAllOnReader(
        user,
        readerId,
        force === '1' || force === 'true',
      );
      writeSseEvent(res, { type: 'job', jobId: job.jobId });
      await observeDeviceSyncJob(this.queue, res, job.jobId);
    } catch (e: unknown) {
      writeSseEvent(res, {
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      res.end();
    }
  }

  @Delete(':readerId/device-users/:userId')
  @ApiOperation({
    summary: 'Remover um usuário da memória do dispositivo',
  })
  removeDeviceUser(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Param('userId') userId: string,
  ) {
    return this.deviceUsers.removeDeviceUser(user, readerId, userId);
  }

  @Get(':readerId/device-users/:userId/face')
  @ApiOperation({
    summary: 'Obter a foto do rosto do usuário (direto do leitor)',
  })
  getDeviceUserFace(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
    @Param('userId') userId: string,
  ) {
    return this.deviceUsers.getDeviceUserFace(user, readerId, userId);
  }
}
