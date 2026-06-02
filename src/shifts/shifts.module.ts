import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { FaceSyncModule } from '../face-sync/face-sync.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [DatabaseModule, PermissionsModule, FaceSyncModule],
  controllers: [ShiftsController],
  providers: [ShiftsService],
})
export class ShiftsModule {}
