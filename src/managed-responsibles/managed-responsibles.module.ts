import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { FaceSyncModule } from '../face-sync/face-sync.module';
import { LprPlateSyncModule } from '../lpr-plate-sync/lpr-plate-sync.module';
import { StorageModule } from '../storage/storage.module';
import { ManagedResponsiblesController } from './managed-responsibles.controller';
import { ManagedResponsiblesService } from './managed-responsibles.service';
import { PublicResponsibleRegisterController } from './public-responsible-register.controller';
import { PublicResponsibleRegisterService } from './public-responsible-register.service';

@Module({
  imports: [
    DatabaseModule,
    StorageModule,
    FaceSyncModule,
    LprPlateSyncModule,
  ],
  controllers: [
    ManagedResponsiblesController,
    PublicResponsibleRegisterController,
  ],
  providers: [ManagedResponsiblesService, PublicResponsibleRegisterService],
  exports: [ManagedResponsiblesService],
})
export class ManagedResponsiblesModule {}
