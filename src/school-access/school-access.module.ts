import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { SchoolAccessService } from './school-access.service';

@Module({
  imports: [DatabaseModule, PermissionsModule],
  providers: [SchoolAccessService],
  exports: [SchoolAccessService],
})
export class SchoolAccessModule {}
