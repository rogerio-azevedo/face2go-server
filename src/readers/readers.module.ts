import { Module } from '@nestjs/common';

import { PermissionsModule } from '../permissions/permissions.module';
import { ReadersController } from './readers.controller';
import { ReadersService } from './readers.service';

@Module({
  imports: [PermissionsModule],
  controllers: [ReadersController],
  providers: [ReadersService],
})
export class ReadersModule {}
