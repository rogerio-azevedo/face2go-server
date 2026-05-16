import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { VehiclesResponsibleController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  imports: [DatabaseModule],
  controllers: [VehiclesResponsibleController],
  providers: [VehiclesService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
