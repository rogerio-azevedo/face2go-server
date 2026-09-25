import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DeviceSyncAdminService } from './device-sync-admin.service';
import { DeviceSyncQueueService } from './device-sync-queue.service';

@ApiTags('device-sync-jobs')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator', 'client_admin', 'client_operator')
@Controller('device-sync-jobs')
export class DeviceSyncJobsController {
  constructor(
    private readonly queue: DeviceSyncQueueService,
    private readonly admin: DeviceSyncAdminService,
  ) {}

  @Get(':jobId')
  @ApiOperation({ summary: 'Status de um job de sync de dispositivo' })
  async getJob(
    @CurrentUser() user: JwtPayload,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const row = await this.queue.getById(jobId);
    if (!row) throw new NotFoundException('Job não encontrado.');
    await this.admin.ensureJobReadable(user, row.clientId);
    return this.queue.toDto(row);
  }
}
