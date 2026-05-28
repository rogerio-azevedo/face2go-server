import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';

import { getHealthPayload } from './build-info';

/** Responde em `GET /` (fora do prefixo global `/api`) para load balancers e probes. */
@ApiExcludeController()
@Controller()
export class RootHealthController {
  @Public()
  @Get()
  rootPing() {
    return getHealthPayload();
  }
}
