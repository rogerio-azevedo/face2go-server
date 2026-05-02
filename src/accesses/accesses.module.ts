import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { DatabaseModule } from '../database/database.module';
import { FacialAccess, FacialAccessSchema } from './access.schema';
import { AccessesController } from './accesses.controller';
import { AccessesService } from './accesses.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FacialAccess.name, schema: FacialAccessSchema },
    ]),
    DatabaseModule,
  ],
  controllers: [AccessesController],
  providers: [AccessesService],
  exports: [AccessesService],
})
export class AccessesModule {}
