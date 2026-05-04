import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { RootHealthController } from './root-health.controller';

@Module({
  controllers: [HealthController, RootHealthController],
})
export class HealthModule {}
