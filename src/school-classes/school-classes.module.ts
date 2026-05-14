import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { SchoolAccessModule } from '../school-access/school-access.module';
import { SchoolClassesController } from './school-classes.controller';
import { SchoolClassesService } from './school-classes.service';

@Module({
  imports: [DatabaseModule, SchoolAccessModule],
  controllers: [SchoolClassesController],
  providers: [SchoolClassesService],
})
export class SchoolClassesModule {}
