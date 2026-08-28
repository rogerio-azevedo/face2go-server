import { Module } from '@nestjs/common';

import { PermissionsModule } from '../permissions/permissions.module';
import { StorageModule } from '../storage/storage.module';
import { ClientReportsController } from './client-reports.controller';
import { CompanyReportsController } from './company-reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [PermissionsModule, StorageModule],
  controllers: [CompanyReportsController, ClientReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
