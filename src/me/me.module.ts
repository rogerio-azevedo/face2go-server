import { Module } from '@nestjs/common';

import { PermissionsModule } from '../permissions/permissions.module';
import { MeController } from './me.controller';

@Module({
  imports: [PermissionsModule],
  controllers: [MeController],
})
export class MeModule {}
