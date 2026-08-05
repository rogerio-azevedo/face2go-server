import { Test, TestingModule } from '@nestjs/testing';

import { DatabaseService } from '../database/database.service';
import * as presenceQueries from '../database/queries/presence.queries';
import type { AccessFacialRecordedPayload } from '../notifications/notifications.events';

import { PresenceListener } from './presence.listener';

jest.mock('../database/queries/presence.queries');

describe('PresenceListener', () => {
  let listener: PresenceListener;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PresenceListener,
        {
          provide: DatabaseService,
          useValue: { db: {} },
        },
      ],
    }).compile();

    listener = module.get(PresenceListener);
  });

  it('grava presença quando payload simulado inclui identidade e sentido in', async () => {
    const payload: AccessFacialRecordedPayload = {
      accessId: 'access-1',
      faceId: 123,
      clientId: 'client-1',
      companyId: 'company-1',
      personId: 'member-1',
      personType: 'member',
      personName: 'Dario Funcionario',
      readerId: 'reader-1',
      readerName: 'Catraca Entrada',
      readerDirection: 'in',
      eventDate: new Date('2026-08-05T15:00:00.000Z'),
    };

    await listener.handleFacialAccess(payload);

    expect(presenceQueries.upsertPresenceState).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        companyId: 'company-1',
        clientId: 'client-1',
        personId: 'member-1',
        personType: 'member',
        status: 'in',
        lastDirection: 'in',
        lastSource: 'facial',
      }),
    );
  });

  it('ignora evento sem personId (comportamento anterior do simulador)', async () => {
    await listener.handleFacialAccess({
      accessId: 'access-1',
      faceId: 123,
      clientId: 'client-1',
      companyId: 'company-1',
      personId: null,
      personType: null,
      personName: 'Dario Funcionario',
      readerId: 'reader-1',
      readerName: 'Catraca Entrada',
      readerDirection: 'in',
      eventDate: new Date(),
    });

    expect(presenceQueries.upsertPresenceState).not.toHaveBeenCalled();
  });
});
