import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { IenhFilialMappingService } from './ienh-filial-mapping.service';
import { IenhSyncService } from './ienh-sync.service';
import { IenhController } from './ienh.controller';
import { IenhService } from './ienh.service';
import { TotvsIenhClient } from './totvs-ienh.client';

@Module({
  imports: [DatabaseModule, StorageModule],
  controllers: [IenhController],
  providers: [
    IenhService,
    IenhSyncService,
    IenhFilialMappingService,
    TotvsIenhClient,
  ],
  exports: [IenhService, IenhSyncService, TotvsIenhClient],
})
export class IenhModule {}
