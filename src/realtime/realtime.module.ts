import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { MonitoringGateway } from './monitoring.gateway';

@Module({
  imports: [AuthModule, PermissionsModule],
  providers: [MonitoringGateway],
  exports: [MonitoringGateway],
})
export class RealtimeModule {}
