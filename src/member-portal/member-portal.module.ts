import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { ResponsibleDashboardModule } from '../responsible-dashboard/responsible-dashboard.module';
import { StorageModule } from '../storage/storage.module';
import { MemberPortalController } from './member-portal.controller';
import { MemberPortalService } from './member-portal.service';

@Module({
  imports: [DatabaseModule, StorageModule, ResponsibleDashboardModule],
  controllers: [MemberPortalController],
  providers: [MemberPortalService],
})
export class MemberPortalModule {}
