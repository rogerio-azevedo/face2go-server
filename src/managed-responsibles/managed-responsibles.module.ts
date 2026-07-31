import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { FaceSyncModule } from '../face-sync/face-sync.module';
import { LprPlateSyncModule } from '../lpr-plate-sync/lpr-plate-sync.module';
import { PeopleModule } from '../people/people.module';
import { StorageModule } from '../storage/storage.module';
import { ManagedResponsiblesController } from './managed-responsibles.controller';
import { ManagedResponsibleCreateService } from './managed-responsible-create.service';
import { ManagedResponsiblesService } from './managed-responsibles.service';
import { PublicResponsibleRegisterController } from './public-responsible-register.controller';
import { PublicResponsibleRegisterService } from './public-responsible-register.service';

@Module({
  imports: [DatabaseModule, StorageModule, FaceSyncModule, LprPlateSyncModule, PeopleModule],
  controllers: [
    ManagedResponsiblesController,
    PublicResponsibleRegisterController,
  ],
  providers: [
    ManagedResponsiblesService,
    ManagedResponsibleCreateService,
    PublicResponsibleRegisterService,
  ],
  exports: [ManagedResponsiblesService, ManagedResponsibleCreateService],
})
export class ManagedResponsiblesModule {}
