import { Injectable } from '@nestjs/common';

import * as responsiblesQueries from '../queries/responsibles.queries';
import { BaseRepository } from './base.repository';

@Injectable()
export class ResponsiblesRepository extends BaseRepository {
  findById(clientId: string, responsibleId: string) {
    return responsiblesQueries.getResponsibleById(
      this.db,
      responsibleId,
      clientId,
    );
  }

  listByClient(clientId: string) {
    return responsiblesQueries.listResponsiblesByClient(this.db, clientId);
  }
}
