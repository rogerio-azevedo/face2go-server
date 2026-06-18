import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database.service';
import * as clientAddressesQueries from '../queries/client-addresses.queries';

@Injectable()
export class ClientAddressesRepository {
  constructor(private readonly database: DatabaseService) {}

  listByClient(clientId: string) {
    return clientAddressesQueries.listAddressesByClient(
      this.database.db,
      clientId,
    );
  }

  getById(clientId: string, addressId: string) {
    return clientAddressesQueries.getAddressById(
      this.database.db,
      clientId,
      addressId,
    );
  }

  getPrimary(clientId: string) {
    return clientAddressesQueries.getPrimaryAddress(
      this.database.db,
      clientId,
    );
  }

  create(data: clientAddressesQueries.ClientAddressInsert) {
    return clientAddressesQueries.createAddress(this.database.db, data);
  }

  update(
    clientId: string,
    addressId: string,
    data: clientAddressesQueries.ClientAddressUpdate,
  ) {
    return clientAddressesQueries.updateAddress(
      this.database.db,
      clientId,
      addressId,
      data,
    );
  }

  delete(clientId: string, addressId: string) {
    return clientAddressesQueries.deleteAddress(
      this.database.db,
      clientId,
      addressId,
    );
  }

  setPrimary(clientId: string, addressId: string) {
    return clientAddressesQueries.setPrimaryAddress(
      this.database.db,
      clientId,
      addressId,
    );
  }

  clearPrimary(clientId: string, exceptId?: string) {
    return clientAddressesQueries.clearPrimaryForClient(
      this.database.db,
      clientId,
      exceptId,
    );
  }
}
