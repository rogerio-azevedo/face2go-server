import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { SchoolAccessModule } from '../school-access/school-access.module';
import { ClientVehiclesController } from './client-school-vehicles.controller';
import { VehiclesResponsibleController } from './vehicles.controller';
import { VehiclesMemberController } from './vehicles-member.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  imports: [DatabaseModule, SchoolAccessModule],
  controllers: [
    ClientVehiclesController,
    VehiclesResponsibleController,
    VehiclesMemberController,
  ],
  providers: [VehiclesService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
