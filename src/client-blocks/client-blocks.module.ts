import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ClientBlocksController } from './client-blocks.controller';
import { ClientBlocksRepository } from './client-blocks.repository';
import { ClientBlocksService } from './client-blocks.service';
import { CondominiumAccessService } from './condominium-access.service';

@Module({
  imports: [DatabaseModule, PermissionsModule],
  controllers: [ClientBlocksController],
  providers: [
    ClientBlocksRepository,
    ClientBlocksService,
    CondominiumAccessService,
  ],
  exports: [ClientBlocksRepository],
})
export class ClientBlocksModule {}
