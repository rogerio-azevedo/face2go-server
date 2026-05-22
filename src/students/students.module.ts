import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { SchoolAccessModule } from '../school-access/school-access.module';
import { StorageModule } from '../storage/storage.module';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [DatabaseModule, SchoolAccessModule, StorageModule],
  controllers: [StudentsController],
  providers: [StudentsService],
})
export class StudentsModule {}
