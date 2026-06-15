import { Injectable } from '@nestjs/common';

import * as clientsQueries from '../queries/clients.queries';
import { BaseRepository } from './base.repository';

@Injectable()
export class ClientsRepository extends BaseRepository {
  findById(clientId: string) {
    return clientsQueries.getClientByIdOnly(this.db, clientId);
  }

  listByCompany(companyId: string) {
    return clientsQueries.listClients(this.db, companyId);
  }

  create(data: Parameters<typeof clientsQueries.createClient>[1]) {
    return clientsQueries.createClient(this.db, data);
  }

  update(
    companyId: string,
    clientId: string,
    data: Parameters<typeof clientsQueries.updateClient>[3],
  ) {
    return clientsQueries.updateClient(this.db, companyId, clientId, data);
  }
}
