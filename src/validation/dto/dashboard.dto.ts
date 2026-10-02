import { createZodDto } from 'nestjs-zod';

import { clientDashboardSchema } from '../dashboard.schema';

export class ClientDashboardDto extends createZodDto(clientDashboardSchema) {}
