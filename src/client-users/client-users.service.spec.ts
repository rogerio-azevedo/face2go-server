import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as clientUsersQueries from '../database/queries/client-users.queries';
import * as clientsQueries from '../database/queries/clients.queries';
import * as usersQueries from '../database/queries/users.queries';
import { ClientUsersService } from './client-users.service';

jest.mock('../database/queries/client-users.queries');
jest.mock('../database/queries/clients.queries');
jest.mock('../database/queries/users.queries');

const companyAdmin: JwtPayload = {
  sub: 'admin-user',
  email: 'admin@empresa.com',
  role: 'company_admin',
  contextType: 'company',
  companyId: 'company-1',
};

const clientUserRow = {
  id: 'cu-1',
  clientId: 'client-1',
  userId: 'user-sueli',
  role: 'client_admin' as const,
  isActive: true,
  createdAt: new Date(),
  notes: null,
};

describe('ClientUsersService', () => {
  let service: ClientUsersService;
  const mockDb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest
      .spyOn(clientsQueries, 'getClientById')
      .mockResolvedValue({ id: 'client-1' } as never);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientUsersService,
        { provide: DatabaseService, useValue: { db: mockDb } },
      ],
    }).compile();

    service = module.get(ClientUsersService);
  });

  it('recusa operador da empresa', async () => {
    await expect(
      service.setActive(
        { ...companyAdmin, role: 'company_operator' },
        'client-1',
        'cu-1',
        { isActive: false },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('não deixa desativar o próprio usuário', async () => {
    jest
      .spyOn(clientUsersQueries, 'getClientUserRow')
      .mockResolvedValue({ ...clientUserRow, userId: companyAdmin.sub });

    await expect(
      service.setActive(companyAdmin, 'client-1', 'cu-1', { isActive: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('não deixa desativar o último admin ativo', async () => {
    jest
      .spyOn(clientUsersQueries, 'getClientUserRow')
      .mockResolvedValue(clientUserRow);
    jest
      .spyOn(clientUsersQueries, 'countActiveClientAdmins')
      .mockResolvedValue(0);

    await expect(
      service.setActive(companyAdmin, 'client-1', 'cu-1', { isActive: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normaliza e-mail ao atualizar perfil', async () => {
    jest
      .spyOn(clientUsersQueries, 'getClientUserRow')
      .mockResolvedValue(clientUserRow);
    jest
      .spyOn(usersQueries, 'findUserByEmail')
      .mockResolvedValue(null as never);

    await service.updateProfile(companyAdmin, 'client-1', 'cu-1', {
      email: 'PSuelrocha@Gmail.com',
      name: 'Sueli Pereira Rocha',
    });

    expect(mockDb.set).toHaveBeenCalledWith({
      name: 'Sueli Pereira Rocha',
      email: 'psuelrocha@gmail.com',
    });
  });
});
