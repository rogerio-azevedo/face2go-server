import { createZodDto } from 'nestjs-zod';

import { createClientSchema, updateClientSchema } from '../clients.schema';

export class CreateClientDto extends createZodDto(createClientSchema) {}
export class PatchClientDto extends createZodDto(updateClientSchema) {}
