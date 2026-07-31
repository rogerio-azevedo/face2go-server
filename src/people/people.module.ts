import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { FaceSyncModule } from '../face-sync/face-sync.module';
import { StorageModule } from '../storage/storage.module';
import { PersonLookupService } from './person-lookup.service';
import { PersonProfileService } from './person-profile.service';

@Module({
  imports: [DatabaseModule, StorageModule, FaceSyncModule],
  providers: [PersonLookupService, PersonProfileService],
  exports: [PersonLookupService, PersonProfileService],
})
export class PeopleModule {}
