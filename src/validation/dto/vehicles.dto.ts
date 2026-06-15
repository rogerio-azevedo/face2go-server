import { createZodDto } from 'nestjs-zod';

import { createVehicleSchema, updateVehicleSchema } from '../vehicles.schema';

export class CreateVehicleDto extends createZodDto(createVehicleSchema) {}
export class PatchVehicleDto extends createZodDto(updateVehicleSchema) {}
