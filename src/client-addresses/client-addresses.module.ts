import { Module } from '@nestjs/common';

import { PermissionsModule } from '../permissions/permissions.module';
import { ClientAddressesRepository } from '../database/repositories/client-addresses.repository';
import { ClientAddressesController } from './client-addresses.controller';
import { ClientAddressesService } from './client-addresses.service';

@Module({
  imports: [PermissionsModule],
  controllers: [ClientAddressesController],
  providers: [ClientAddressesService, ClientAddressesRepository],
  exports: [ClientAddressesService, ClientAddressesRepository],
})
export class ClientAddressesModule {}
