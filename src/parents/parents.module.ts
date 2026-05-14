import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { SchoolAccessModule } from '../school-access/school-access.module';
import { ParentsController } from './parents.controller';
import { ParentsService } from './parents.service';

@Module({
  imports: [DatabaseModule, SchoolAccessModule],
  controllers: [ParentsController],
  providers: [ParentsService],
})
export class ParentsModule {}
