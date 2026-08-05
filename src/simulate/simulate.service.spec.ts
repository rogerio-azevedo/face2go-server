import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { FacialAccess } from '../accesses/access.schema';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import * as membersQueries from '../database/queries/members.queries';
import * as readersQueries from '../database/queries/readers.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import {
  ACCESS_FACIAL_RECORDED,
  type AccessFacialRecordedPayload,
} from '../notifications/notifications.events';
import { R2StorageService } from '../storage/r2-storage.service';

import { SimulateService } from './simulate.service';

jest.mock('../database/queries/clients.queries');
jest.mock('../database/queries/members.queries');
jest.mock('../database/queries/readers.queries');
jest.mock('../database/queries/registrations.queries');

describe('SimulateService', () => {
  let service: SimulateService;
  const eventEmitter = { emit: jest.fn() };
  const accessModel = {
    create: jest.fn().mockResolvedValue({
      _id: 'access-1',
      eventDate: new Date('2026-08-05T15:00:00.000Z'),
    }),
  };

  const user = {
    role: 'company_admin',
    companyId: 'company-1',
    sub: 'user-1',
  } as never;

  beforeEach(async () => {
    jest.clearAllMocks();

    jest.mocked(clientsQueries.getClientById).mockResolvedValue({
      id: 'client-1',
      companyId: 'company-1',
      name: 'Escola Santo Antonio',
      type: 'school',
      isActive: true,
    } as never);

    jest.mocked(readersQueries.getReaderById).mockResolvedValue({
      id: 'reader-1',
      clientId: 'client-1',
      name: 'Catraca Entrada',
      direction: 'in',
      isActive: true,
    } as never);

    jest.mocked(membersQueries.getMemberById).mockResolvedValue({
      id: 'member-1',
      name: 'Dario Funcionario',
      faceId: 123,
      photoKey: null,
    } as never);

    jest
      .mocked(registrationsQueries.findApprovedRegistrationNameByFaceId)
      .mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulateService,
        {
          provide: getModelToken(FacialAccess.name),
          useValue: accessModel,
        },
        {
          provide: DatabaseService,
          useValue: { db: {} },
        },
        {
          provide: EventEmitter2,
          useValue: eventEmitter,
        },
        {
          provide: R2StorageService,
          useValue: { createPresignedGetUrl: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(SimulateService);
  });

  it('emite ACCESS_FACIAL_RECORDED com companyId, personId e personType para presença', async () => {
    await service.simulateFaceAccess(user, {
      clientId: 'client-1',
      personId: 'member-1',
      personType: 'member',
      readerId: 'reader-1',
    });

    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      ACCESS_FACIAL_RECORDED,
      expect.objectContaining({
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
      } satisfies Partial<AccessFacialRecordedPayload>),
    );
  });
});
