import { ConflictException } from '@nestjs/common';

import * as membersQueries from '../database/queries/members.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import type { AppDb } from '../database/database.types';
import {
  assertDocumentAvailableInClient,
  DOCUMENT_ALREADY_MEMBER_MESSAGE,
  DOCUMENT_ALREADY_PENDING_MESSAGE,
  DOCUMENT_ALREADY_REGISTERED_MESSAGE,
} from './registration-document-unique';

const db = {} as AppDb;
const CPF = '529.982.247-25';

describe('assertDocumentAvailableInClient', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest
      .spyOn(membersQueries, 'findMemberByNormalizedDocument')
      .mockResolvedValue(null);
    jest
      .spyOn(registrationsQueries, 'findRegistrationByNormalizedDocument')
      .mockResolvedValue(null);
  });

  it('não consulta quando o documento está vazio', async () => {
    const memberSpy = jest.spyOn(
      membersQueries,
      'findMemberByNormalizedDocument',
    );
    await assertDocumentAvailableInClient(db, 'client-1', null);
    await assertDocumentAvailableInClient(db, 'client-1', '   ');
    expect(memberSpy).not.toHaveBeenCalled();
  });

  it('bloqueia quando já existe membro no mesmo cliente', async () => {
    jest
      .spyOn(membersQueries, 'findMemberByNormalizedDocument')
      .mockResolvedValue({ id: 'member-1' } as never);

    await expect(
      assertDocumentAvailableInClient(db, 'client-1', CPF),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      assertDocumentAvailableInClient(db, 'client-1', CPF),
    ).rejects.toThrow(DOCUMENT_ALREADY_MEMBER_MESSAGE);
  });

  it('bloqueia rascunho enviado com a mensagem de análise', async () => {
    jest
      .spyOn(registrationsQueries, 'findRegistrationByNormalizedDocument')
      .mockResolvedValue({ id: 'reg-1', status: 'draft' } as never);

    await expect(
      assertDocumentAvailableInClient(db, 'client-1', '52998224725'),
    ).rejects.toThrow(DOCUMENT_ALREADY_PENDING_MESSAGE);
  });

  it.each(['approved', 'blocked', 'rejected'] as const)(
    'bloqueia cadastro %s com a mensagem genérica',
    async (status) => {
      jest
        .spyOn(registrationsQueries, 'findRegistrationByNormalizedDocument')
        .mockResolvedValue({ id: 'reg-1', status, isActive: false } as never);

      await expect(
        assertDocumentAvailableInClient(db, 'client-1', CPF),
      ).rejects.toThrow(DOCUMENT_ALREADY_REGISTERED_MESSAGE);
    },
  );

  it('libera o mesmo documento em outro cliente (queries recebem o clientId)', async () => {
    const memberSpy = jest.spyOn(
      membersQueries,
      'findMemberByNormalizedDocument',
    );
    const registrationSpy = jest.spyOn(
      registrationsQueries,
      'findRegistrationByNormalizedDocument',
    );

    await assertDocumentAvailableInClient(db, 'other-client', CPF);

    expect(memberSpy).toHaveBeenCalledWith(
      db,
      'other-client',
      '52998224725',
      undefined,
    );
    expect(registrationSpy).toHaveBeenCalledWith(
      db,
      'other-client',
      '52998224725',
      undefined,
    );
  });

  it('exclui o próprio membro e o próprio cadastro', async () => {
    const memberSpy = jest.spyOn(
      membersQueries,
      'findMemberByNormalizedDocument',
    );
    const registrationSpy = jest.spyOn(
      registrationsQueries,
      'findRegistrationByNormalizedDocument',
    );

    await assertDocumentAvailableInClient(db, 'client-1', CPF, {
      excludeMemberId: 'member-self',
      excludeRegistrationId: 'reg-self',
    });

    expect(memberSpy).toHaveBeenCalledWith(
      db,
      'client-1',
      '52998224725',
      'member-self',
    );
    expect(registrationSpy).toHaveBeenCalledWith(
      db,
      'client-1',
      '52998224725',
      'reg-self',
    );
  });

  it('não consulta cadastros quando checkRegistrations é false', async () => {
    const registrationSpy = jest.spyOn(
      registrationsQueries,
      'findRegistrationByNormalizedDocument',
    );

    await assertDocumentAvailableInClient(db, 'client-1', CPF, {
      checkRegistrations: false,
    });

    expect(registrationSpy).not.toHaveBeenCalled();
  });
});
