import { Test, TestingModule } from '@nestjs/testing';

import { DatabaseService } from '../database/database.service';
import * as membersQueries from '../database/queries/members.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as usersQueries from '../database/queries/users.queries';
import { PersonLookupService } from './person-lookup.service';

describe('PersonLookupService', () => {
  let service: PersonLookupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonLookupService,
        {
          provide: DatabaseService,
          useValue: { db: {} },
        },
      ],
    }).compile();

    service = module.get(PersonLookupService);
    jest.restoreAllMocks();
  });

  it('retorna não encontrado quando CPF/e-mail não existem', async () => {
    jest.spyOn(usersQueries, 'findUserByEmailOrCpf').mockResolvedValue({
      byEmail: null,
      byCpf: null,
    });
    jest
      .spyOn(membersQueries, 'findMembersByDocumentGlobally')
      .mockResolvedValue([]);
    jest
      .spyOn(responsiblesQueries, 'findResponsiblesByDocumentGlobally')
      .mockResolvedValue([]);
    jest
      .spyOn(membersQueries, 'findMembersByEmailGlobally')
      .mockResolvedValue([]);

    const result = await service.resolvePerson({
      cpf: '92664792091',
      email: 'novo@example.com',
    });

    expect(result.matched).toBe(false);
    expect(result.userId).toBeNull();
  });

  it('detecta responsável existente pelo CPF (cenário pai → membro)', async () => {
    jest.spyOn(usersQueries, 'findUserByEmailOrCpf').mockResolvedValue({
      byEmail: {
        id: 'user-1',
        email: 'kuntze@terra.com.br',
        name: 'MÁRCIO SCHEIFLER KUNTZE',
        password: 'hash',
        cpf: null,
        emailVerified: null,
        image: null,
        role: 'member',
        isActive: true,
      },
      byCpf: null,
    });
    jest
      .spyOn(membersQueries, 'findMembersByDocumentGlobally')
      .mockResolvedValue([]);
    jest
      .spyOn(responsiblesQueries, 'findResponsiblesByDocumentGlobally')
      .mockResolvedValue([
        {
          id: 'resp-1',
          clientId: 'client-1',
          clientName: 'Escola Teste',
          userId: 'user-1',
          name: 'MÁRCIO SCHEIFLER KUNTZE',
          email: 'kuntze@terra.com.br',
          phone: null,
          document: '92664792091',
          isActive: true,
        },
      ]);
    jest
      .spyOn(membersQueries, 'findMembersByEmailGlobally')
      .mockResolvedValue([]);
    jest
      .spyOn(membersQueries, 'listMemberContextsByUserId')
      .mockResolvedValue([]);
    jest
      .spyOn(responsiblesQueries, 'listResponsibleContextsByUserId')
      .mockResolvedValue([
        {
          id: 'resp-1',
          clientId: 'client-1',
          clientName: 'Escola Teste',
          userId: 'user-1',
          name: 'MÁRCIO SCHEIFLER KUNTZE',
          email: 'kuntze@terra.com.br',
          phone: null,
          document: '92664792091',
          isActive: true,
        },
      ]);

    const result = await service.resolvePerson({
      cpf: '92664792091',
      email: 'kuntze@terra.com.br',
    });

    expect(result.matched).toBe(true);
    expect(result.userId).toBe('user-1');
    expect(result.hasLogin).toBe(true);
    expect(result.contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'responsible',
          clientName: 'Escola Teste',
        }),
      ]),
    );
  });

  it('retorna conflito quando CPF e e-mail apontam para users diferentes', async () => {
    jest.spyOn(usersQueries, 'findUserByEmailOrCpf').mockResolvedValue({
      byEmail: { id: 'user-a' } as usersQueries.UserRow,
      byCpf: { id: 'user-b' } as usersQueries.UserRow,
    });

    const result = await service.resolvePerson({
      cpf: '92664792091',
      email: 'outro@example.com',
    });

    expect(result.conflict).toBeDefined();
    expect(result.userId).toBeNull();
  });

  it('não inclui contextos de condomínio — apenas escolas (queries filtradas)', async () => {
    jest.spyOn(usersQueries, 'findUserByEmailOrCpf').mockResolvedValue({
      byEmail: {
        id: 'user-1',
        email: 'rogerio@example.com',
        name: 'Rogerio',
        password: 'hash',
        cpf: null,
        emailVerified: null,
        image: null,
        role: 'member',
        isActive: true,
      },
      byCpf: null,
    });
    jest
      .spyOn(membersQueries, 'findMembersByDocumentGlobally')
      .mockResolvedValue([
        {
          id: 'member-school',
          clientId: 'school-1',
          clientName: 'Escola São Gonçalo',
          userId: 'user-1',
          name: 'Rogerio',
          email: 'rogerio@example.com',
          phone: null,
          document: '12345678901',
          isActive: true,
        },
      ]);
    jest
      .spyOn(responsiblesQueries, 'findResponsiblesByDocumentGlobally')
      .mockResolvedValue([]);
    jest
      .spyOn(membersQueries, 'findMembersByEmailGlobally')
      .mockResolvedValue([]);
    jest.spyOn(membersQueries, 'listMemberContextsByUserId').mockResolvedValue([
      {
        id: 'member-school',
        clientId: 'school-1',
        clientName: 'Escola São Gonçalo',
        userId: 'user-1',
        name: 'Rogerio',
        email: 'rogerio@example.com',
        phone: null,
        document: '12345678901',
        isActive: true,
      },
    ]);
    jest
      .spyOn(responsiblesQueries, 'listResponsibleContextsByUserId')
      .mockResolvedValue([
        {
          id: 'resp-1',
          clientId: 'school-2',
          clientName: 'Escola Santo Antonio',
          userId: 'user-1',
          name: 'Rogerio',
          email: 'rogerio@example.com',
          phone: null,
          document: '12345678901',
          isActive: true,
        },
      ]);

    const result = await service.resolvePerson({
      cpf: '12345678901',
      email: 'rogerio@example.com',
    });

    expect(result.matched).toBe(true);
    expect(result.contexts.every((ctx) => !ctx.clientName.includes('Condomínio'))).toBe(
      true,
    );
    expect(result.contexts).toHaveLength(2);
    expect(result.contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'member', clientName: 'Escola São Gonçalo' }),
        expect.objectContaining({
          type: 'responsible',
          clientName: 'Escola Santo Antonio',
        }),
      ]),
    );
  });
});
