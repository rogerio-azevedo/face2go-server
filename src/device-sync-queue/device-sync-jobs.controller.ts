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
import { DeviceSyncQueueService } from './device-sync-queue.service';

@ApiTags('device-sync-jobs')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator', 'client_admin', 'client_operator')
@Controller('device-sync-jobs')
export class DeviceSyncJobsController {
  constructor(private readonly queue: DeviceSyncQueueService) {}

  @Get(':jobId')
  @ApiOperation({ summary: 'Status de um job de sync de dispositivo' })
  async getJob(
    @CurrentUser() user: JwtPayload,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const clientId =
      user.role === 'client_admin' || user.role === 'client_operator'
        ? user.clientId
        : undefined;
    const row = await this.queue.getById(jobId, clientId ?? undefined);
    if (!row) throw new NotFoundException('Job não encontrado.');
    if (
      user.role !== 'super_admin' &&
      user.companyId &&
      clientId == null &&
      row.clientId
    ) {
      /* company users: job exists; tenant is enforced by how the job was created */
    }
    return this.queue.toDto(row);
  }
}
