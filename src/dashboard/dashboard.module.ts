import { Module } from '@nestjs/common';

import { AccessesModule } from '../accesses/accesses.module';
import { FaceListenerModule } from '../face-listener/face-listener.module';
import { ClientDashboardController } from './client-dashboard.controller';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AccessesModule, FaceListenerModule],
  controllers: [DashboardController, ClientDashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
