import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { RegistrationEventsRepository } from '../database/repositories/registration-events.repository';
import { RegistrationEventsService } from './registration-events.service';

describe('RegistrationEventsService', () => {
  let service: RegistrationEventsService;
  const events = {
    findRegistration: jest.fn(),
    insert: jest.fn(),
    list: jest.fn(),
    findAuthorName: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        RegistrationEventsService,
        { provide: RegistrationEventsRepository, useValue: events },
      ],
    }).compile();
    service = module.get(RegistrationEventsService);
  });

  it('recusa anotação quando o cadastro não pertence ao cliente', async () => {
    events.findRegistration.mockResolvedValue(undefined);
    await expect(
      service.addNote('client-1', 'reg-1', 'user-1', 'Pagou o produto.'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(events.insert).not.toHaveBeenCalled();
  });

  it('grava anotação com o texto e o autor', async () => {
    events.findRegistration.mockResolvedValue({ id: 'reg-1' });
    events.insert.mockResolvedValue({
      id: 'evt-1',
      type: 'note',
      body: 'Pagou o produto.',
      createdAt: new Date('2026-10-02T12:00:00.000Z'),
    });
    events.findAuthorName.mockResolvedValue('Ana');

    const created = await service.addNote(
      'client-1',
      'reg-1',
      'user-1',
      '  Pagou o produto.  ',
    );

    expect(events.insert).toHaveBeenCalledWith(
      {
        clientId: 'client-1',
        registrationId: 'reg-1',
        type: 'note',
        body: 'Pagou o produto.',
        authorUserId: 'user-1',
      },
      undefined,
    );
    expect(created).toMatchObject({
      id: 'evt-1',
      type: 'note',
      body: 'Pagou o produto.',
      authorName: 'Ana',
    });
  });

  it('lista ocorrências só do cadastro do cliente', async () => {
    events.findRegistration.mockResolvedValue({ id: 'reg-1' });
    events.list.mockResolvedValue([
      {
        id: 'evt-1',
        type: 'blocked',
        body: 'Furto',
        authorName: 'Ana',
        createdAt: new Date('2026-10-02T12:00:00.000Z'),
      },
    ]);

    const rows = await service.list('client-1', 'reg-1');

    expect(events.list).toHaveBeenCalledWith('client-1', 'reg-1');
    expect(rows).toEqual([
      {
        id: 'evt-1',
        type: 'blocked',
        body: 'Furto',
        authorName: 'Ana',
        createdAt: '2026-10-02T12:00:00.000Z',
      },
    ]);
  });
});
