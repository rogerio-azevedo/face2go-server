import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import * as membersQueries from '../database/queries/members.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import { EmailService } from '../email/email.service';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { MembersService } from '../members/members.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PersonProfileService } from '../people/person-profile.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { RegistrationEventsService } from './registration-events.service';
import { ClientBlocksRepository } from '../client-blocks/client-blocks.repository';
import { RegistrationsAdminService } from './registrations-admin.service';

function companyAdmin(): JwtPayload {
  return {
    sub: 'admin-1',
    email: 'a@b.c',
    role: 'company_admin',
    contextType: 'company',
    companyId: 'company-1',
  };
}

function companyOperator(): JwtPayload {
  return {
    ...companyAdmin(),
    role: 'company_operator',
    companyUserId: 'cu-1',
  };
}

describe('RegistrationsAdminService lifecycle', () => {
  let service: RegistrationsAdminService;
  const db: {
    transaction: (fn: (tx: object) => Promise<unknown>) => Promise<unknown>;
  } = {
    transaction: (fn) => fn(db),
  };
  const events = { record: jest.fn().mockResolvedValue({ id: 'evt-1' }) };
  let faceSync: {
    removePersonFromReaders: jest.Mock;
    enqueueApprovedRegistrationJob: jest.Mock;
    hasActiveFacialReaders: jest.Mock;
    getReaderSyncCounts: jest.Mock;
  };
  let members: {
    getByRegistrationId: jest.Mock;
    setActiveByRegistrationId: jest.Mock;
    syncProfileFromRegistration: jest.Mock;
    upsertFromApprovedRegistration: jest.Mock;
  };
  let personProfile: { shouldRemoveFaceFromReader: jest.Mock };
  let email: { sendRegistrationApprovedEmail: jest.Mock };

  beforeEach(async () => {
    faceSync = {
      removePersonFromReaders: jest.fn().mockResolvedValue({
        removed: 1,
        total: 1,
        failures: [],
      }),
      enqueueApprovedRegistrationJob: jest.fn().mockResolvedValue({}),
      hasActiveFacialReaders: jest.fn().mockResolvedValue(true),
      getReaderSyncCounts: jest.fn().mockResolvedValue({
        total: 3,
        syncedByFace: new Map(),
      }),
    };
    members = {
      getByRegistrationId: jest.fn().mockResolvedValue({ id: 'member-1' }),
      setActiveByRegistrationId: jest
        .fn()
        .mockResolvedValue({ id: 'member-1' }),
      syncProfileFromRegistration: jest.fn().mockResolvedValue(null),
      upsertFromApprovedRegistration: jest.fn().mockResolvedValue(null),
    };
    personProfile = {
      shouldRemoveFaceFromReader: jest.fn().mockResolvedValue(true),
    };
    email = {
      sendRegistrationApprovedEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        RegistrationsAdminService,
        { provide: DatabaseService, useValue: { db } },
        { provide: RegistrationEventsService, useValue: events },
        { provide: PermissionsService, useValue: {} },
        {
          provide: R2StorageService,
          useValue: { createPresignedGetUrl: jest.fn() },
        },
        { provide: FaceSyncService, useValue: faceSync },
        { provide: MembersService, useValue: members },
        { provide: PersonProfileService, useValue: personProfile },
        { provide: EmailService, useValue: email },
        { provide: ClientBlocksRepository, useValue: {} },
      ],
    }).compile();

    service = module.get(RegistrationsAdminService);
    jest
      .spyOn(registrationsQueries, 'getRegistrationLinkByIdForClient')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('bloqueia exclusão para operador da empresa', async () => {
    await expect(
      service.softDeleteForCompanyUser(companyOperator(), 'client-1', 'reg-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('exclui cadastro aprovado, remove face e desativa o membro', async () => {
    jest.spyOn(clientsQueries, 'getClientById').mockResolvedValue({
      id: 'client-1',
      companyId: 'company-1',
    } as never);
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValue({
        id: 'reg-1',
        clientId: 'client-1',
        status: 'approved',
        isActive: true,
        faceId: 12,
        faceImageKey: 'k',
        name: 'Ana',
      } as never);
    jest
      .spyOn(registrationsQueries, 'setRegistrationActive')
      .mockResolvedValue({
        id: 'reg-1',
        clientId: 'client-1',
        status: 'approved',
        isActive: false,
        faceId: 12,
        name: 'Ana',
      } as never);

    await service.softDeleteForCompanyUser(companyAdmin(), 'client-1', 'reg-1');

    expect(faceSync.removePersonFromReaders).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-1', faceId: 12 }),
    );
    expect(members.setActiveByRegistrationId).toHaveBeenCalledWith(
      'client-1',
      'reg-1',
      false,
    );
  });

  it('restaura cadastro e enfileira resync da face', async () => {
    jest.spyOn(clientsQueries, 'getClientById').mockResolvedValue({
      id: 'client-1',
      companyId: 'company-1',
    } as never);
    const getReg = jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValue({
        id: 'reg-1',
        clientId: 'client-1',
        status: 'approved',
        isActive: false,
        faceId: 12,
        faceImageKey: 'k',
        name: 'Ana',
      } as never);
    jest
      .spyOn(registrationsQueries, 'setRegistrationActive')
      .mockResolvedValue({
        id: 'reg-1',
        clientId: 'client-1',
        status: 'approved',
        isActive: true,
        faceId: 12,
        faceImageKey: 'k',
        name: 'Ana',
      } as never);

    await service.restoreForCompanyUser(companyAdmin(), 'client-1', 'reg-1');

    expect(members.setActiveByRegistrationId).toHaveBeenCalledWith(
      'client-1',
      'reg-1',
      true,
    );
    expect(faceSync.enqueueApprovedRegistrationJob).toHaveBeenCalledWith(
      'reg-1',
      'client-1',
      'admin-1',
      { resetReaderProgress: true },
    );
    expect(getReg).toHaveBeenCalled();
  });

  it('desbloqueia cadastro, limpa o membro e reenvia a face com blocked=false', async () => {
    jest.spyOn(clientsQueries, 'getClientById').mockResolvedValue({
      id: 'client-1',
      companyId: 'company-1',
    } as never);
    const blockedRow = {
      id: 'reg-1',
      clientId: 'client-1',
      status: 'blocked',
      isActive: true,
      submittedAt: new Date(),
      faceId: 1,
      faceImageKey: 'k',
      name: 'Rogerio',
    };
    const approvedRow = { ...blockedRow, status: 'approved' };
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValueOnce(blockedRow as never)
      .mockResolvedValueOnce(approvedRow as never);
    jest
      .spyOn(registrationsQueries, 'unblockRegistration')
      .mockResolvedValue(approvedRow as never);
    const clearMember = jest
      .spyOn(membersQueries, 'setMemberBlockByRegistrationId')
      .mockResolvedValue(null);
    jest.spyOn(clientsQueries, 'getClientByIdOnly').mockResolvedValue({
      id: 'client-1',
      type: 'company',
    } as never);

    await service.unblockForCompanyUser(companyAdmin(), 'client-1', 'reg-1');

    expect(members.upsertFromApprovedRegistration).toHaveBeenCalledWith(
      approvedRow,
      'company',
    );

    expect(clearMember).toHaveBeenCalledWith(db, 'client-1', 'reg-1', {
      blockReason: null,
      blockedAt: null,
      blockedByUserId: null,
    });
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        registrationId: 'reg-1',
        type: 'unblocked',
        authorUserId: 'admin-1',
        body: null,
      }),
      db,
    );
    expect(faceSync.enqueueApprovedRegistrationJob).toHaveBeenCalledWith(
      'reg-1',
      'client-1',
      'admin-1',
      { resetReaderProgress: true, blocked: false },
    );
    expect(email.sendRegistrationApprovedEmail).not.toHaveBeenCalled();
  });

  it('bloqueia cadastro e registra o motivo na timeline', async () => {
    jest.spyOn(clientsQueries, 'getClientById').mockResolvedValue({
      id: 'client-1',
      companyId: 'company-1',
    } as never);
    const approvedRow = {
      id: 'reg-1',
      clientId: 'client-1',
      status: 'approved',
      isActive: true,
      submittedAt: new Date(),
      faceId: 1,
      faceImageKey: 'k',
      name: 'Rogerio',
    };
    const blockedRow = {
      ...approvedRow,
      status: 'blocked',
      blockReason: 'Furto no mercado',
      blockedAt: new Date(),
    };
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValueOnce(approvedRow as never)
      .mockResolvedValueOnce(blockedRow as never);
    jest
      .spyOn(registrationsQueries, 'blockRegistration')
      .mockResolvedValue(blockedRow as never);
    jest
      .spyOn(membersQueries, 'setMemberBlockByRegistrationId')
      .mockResolvedValue(null);

    await service.blockForCompanyUser(companyAdmin(), 'client-1', 'reg-1', {
      reason: 'Furto no mercado',
    });

    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        registrationId: 'reg-1',
        type: 'blocked',
        authorUserId: 'admin-1',
        body: 'Furto no mercado',
      }),
      db,
    );
    expect(faceSync.enqueueApprovedRegistrationJob).toHaveBeenCalledWith(
      'reg-1',
      'client-1',
      'admin-1',
      { resetReaderProgress: true, blocked: true },
    );
    expect(email.sendRegistrationApprovedEmail).not.toHaveBeenCalled();
  });

  function mockApprove(row: Record<string, unknown>) {
    jest.spyOn(clientsQueries, 'getClientById').mockResolvedValue({
      id: 'client-1',
      companyId: 'company-1',
    } as never);
    jest.spyOn(clientsQueries, 'getClientByIdOnly').mockResolvedValue({
      id: 'client-1',
      name: 'Escola Alfa',
      type: 'school',
    } as never);
    jest
      .spyOn(registrationsQueries, 'getRegistrationByIdForClient')
      .mockResolvedValue(row as never);
    jest
      .spyOn(registrationsQueries, 'approveRegistration')
      .mockResolvedValue(row as never);
  }

  it('envia e-mail quando o cadastro aprovado tem e-mail', async () => {
    mockApprove({
      id: 'reg-1',
      clientId: 'client-1',
      status: 'approved',
      isActive: true,
      submittedAt: new Date(),
      name: 'Ana',
      email: 'ana@example.com',
    });

    await service.approveForCompanyUser(companyAdmin(), 'client-1', 'reg-1');

    expect(email.sendRegistrationApprovedEmail).toHaveBeenCalledWith({
      to: 'ana@example.com',
      name: 'Ana',
      clientName: 'Escola Alfa',
    });
  });

  it('não envia e-mail quando o cadastro aprovado não tem e-mail', async () => {
    mockApprove({
      id: 'reg-1',
      clientId: 'client-1',
      status: 'approved',
      isActive: true,
      submittedAt: new Date(),
      name: 'Ana',
      email: null,
    });

    await service.approveForCompanyUser(companyAdmin(), 'client-1', 'reg-1');

    expect(email.sendRegistrationApprovedEmail).not.toHaveBeenCalled();
  });
});
