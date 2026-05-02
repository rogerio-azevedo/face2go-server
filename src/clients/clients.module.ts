import { Module } from '@nestjs/common';

import { PermissionsModule } from '../permissions/permissions.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [PermissionsModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
