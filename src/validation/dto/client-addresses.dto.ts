import { createZodDto } from 'nestjs-zod';

import {
  createClientAddressSchema,
  updateClientAddressSchema,
} from '../client-addresses.schema';

export class CreateClientAddressDto extends createZodDto(
  createClientAddressSchema,
) {}

export class PatchClientAddressDto extends createZodDto(
  updateClientAddressSchema,
) {}
