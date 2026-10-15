import { createZodDto } from 'nestjs-zod';

import {
  clientAlertsListQuerySchema,
  clientAlertsListSchema,
} from '../alerts.schema';

export class ClientAlertsListQueryDto extends createZodDto(
  clientAlertsListQuerySchema,
) {}

export class ClientAlertsListDto extends createZodDto(clientAlertsListSchema) {}
