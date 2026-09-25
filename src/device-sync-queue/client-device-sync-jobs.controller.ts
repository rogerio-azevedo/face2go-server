import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  DeviceSyncCancelQueuedResultDto,
  DeviceSyncJobCancelResultDto,
  DeviceSyncJobDto,
  DeviceSyncJobListDto,
  DeviceSyncJobSummaryDto,
  ListDeviceSyncJobsQueryDto,
} from '../validation/dto/device-sync-jobs.dto';
import { DeviceSyncAdminService } from './device-sync-admin.service';

@ApiTags('device-sync-jobs')
@ApiBearerAuth()
@Roles('company_admin')
@Controller('clients/:clientId/device-sync-jobs')
export class ClientDeviceSyncJobsController {
  constructor(private readonly admin: DeviceSyncAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Fila de sync de dispositivos do cliente' })
  @ApiOkResponse({ type: DeviceSyncJobListDto })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query() query: ListDeviceSyncJobsQueryDto,
  ) {
    return this.admin.list(user, clientId, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Contagem de jobs por status' })
  @ApiOkResponse({ type: DeviceSyncJobSummaryDto })
  summary(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.admin.summary(user, clientId);
  }

  @Post('cancel-queued')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancela todos os jobs ainda na fila' })
  @ApiOkResponse({ type: DeviceSyncCancelQueuedResultDto })
  cancelQueued(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.admin.cancelQueued(user, clientId);
  }

  @Post(':jobId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancela um job (na fila: imediato; em execução: no próximo item)',
  })
  @ApiOkResponse({ type: DeviceSyncJobCancelResultDto })
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.admin.cancel(user, clientId, jobId);
  }

  @Post(':jobId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reenfileira um job com falha ou cancelado' })
  @ApiOkResponse({ type: DeviceSyncJobDto })
  retry(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.admin.retry(user, clientId, jobId);
  }
}
