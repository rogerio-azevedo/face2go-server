import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { PersonLookupService } from './person-lookup.service';

@Module({
  imports: [DatabaseModule],
  providers: [PersonLookupService],
  exports: [PersonLookupService],
})
export class PeopleModule {}
