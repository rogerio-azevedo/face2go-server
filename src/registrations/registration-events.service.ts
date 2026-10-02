import { Injectable, NotFoundException } from '@nestjs/common';

import type { AppDb } from '../database/database.types';
import type { RegistrationEventType } from '../database/queries/registration-events.queries';
import { RegistrationEventsRepository } from '../database/repositories/registration-events.repository';

export type RegistrationEventView = {
  id: string;
  type: RegistrationEventType;
  body: string | null;
  authorName: string | null;
  createdAt: string;
};

@Injectable()
export class RegistrationEventsService {
  constructor(private readonly events: RegistrationEventsRepository) {}

  async list(
    clientId: string,
    registrationId: string,
  ): Promise<RegistrationEventView[]> {
    await this.ensureRegistration(clientId, registrationId);
    const rows = await this.events.list(clientId, registrationId);
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      body: row.body,
      authorName: row.authorName,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async addNote(
    clientId: string,
    registrationId: string,
    authorUserId: string,
    body: string,
  ): Promise<RegistrationEventView> {
    await this.ensureRegistration(clientId, registrationId);
    const created = await this.record({
      clientId,
      registrationId,
      type: 'note',
      authorUserId,
      body,
    });
    const authorName = await this.events.findAuthorName(authorUserId);
    return { ...created, authorName };
  }

  async record(
    input: {
      clientId: string;
      registrationId: string;
      type: RegistrationEventType;
      authorUserId: string | null;
      body?: string | null;
    },
    db?: AppDb,
  ): Promise<RegistrationEventView> {
    const text = input.body?.trim() ? input.body.trim() : null;
    const row = await this.events.insert(
      {
        clientId: input.clientId,
        registrationId: input.registrationId,
        type: input.type,
        body: text,
        authorUserId: input.authorUserId,
      },
      db,
    );
    return {
      id: row.id,
      type: row.type,
      body: row.body,
      authorName: null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async ensureRegistration(clientId: string, registrationId: string) {
    const row = await this.events.findRegistration(clientId, registrationId);
    if (!row) {
      throw new NotFoundException('Cadastro não encontrado.');
    }
    return row;
  }
}
