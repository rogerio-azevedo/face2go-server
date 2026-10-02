import { Injectable } from '@nestjs/common';

import type { AppDb } from '../database.types';
import * as eventQueries from '../queries/registration-events.queries';
import * as registrationsQueries from '../queries/registrations.queries';
import { BaseRepository } from './base.repository';

@Injectable()
export class RegistrationEventsRepository extends BaseRepository {
  findRegistration(clientId: string, registrationId: string) {
    return registrationsQueries.getRegistrationByIdForClient(
      this.db,
      registrationId,
      clientId,
    );
  }

  insert(
    input: Parameters<typeof eventQueries.insertRegistrationEvent>[1],
    db: AppDb = this.db,
  ) {
    return eventQueries.insertRegistrationEvent(db, input);
  }

  list(clientId: string, registrationId: string) {
    return eventQueries.listRegistrationEvents(
      this.db,
      clientId,
      registrationId,
    );
  }

  findAuthorName(userId: string) {
    return eventQueries.findUserName(this.db, userId);
  }
}
