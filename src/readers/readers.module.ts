import { Module } from '@nestjs/common';

import { FaceListenerModule } from '../face-listener/face-listener.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ReadersController } from './readers.controller';
import { ReadersService } from './readers.service';

@Module({
  imports: [PermissionsModule, FaceListenerModule],
  controllers: [ReadersController],
  providers: [ReadersService],
})
export class ReadersModule {}
