import { Module, Global } from '@nestjs/common';

import { DatabaseModule } from '../database.module';
import { ClientsRepository } from './clients.repository';
import { ReportsRepository } from './reports.repository';
import { ResponsiblesRepository } from './responsibles.repository';
import { StudentsRepository } from './students.repository';

const repositories = [
  ClientsRepository,
  ReportsRepository,
  StudentsRepository,
  ResponsiblesRepository,
];

@Global()
@Module({
  imports: [DatabaseModule],
  providers: repositories,
  exports: repositories,
})
export class RepositoriesModule {}
