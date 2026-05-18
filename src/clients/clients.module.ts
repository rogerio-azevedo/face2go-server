import { Module } from '@nestjs/common';

import { PermissionsModule } from '../permissions/permissions.module';
import { ClientDisplayResolveController } from './client-display-resolve.controller';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [PermissionsModule],
  controllers: [ClientsController, ClientDisplayResolveController],
  providers: [ClientsService],
})
export class ClientsModule {}
