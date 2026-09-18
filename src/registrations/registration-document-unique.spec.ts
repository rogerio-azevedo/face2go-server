import { ConflictException } from '@nestjs/common';

import * as membersQueries from '../database/queries/members.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import type { AppDb } from '../database/database.types';
import {
  assertDocumentAvailableInClient,
  DOCUMENT_ALREADY_MEMBER_MESSAGE,
  DOCUMENT_ALREADY_PENDING_MESSAGE,
} from './registration-document-unique';

const db = {} as AppDb;
const CPF = '529.982.247-25';

describe('assertDocumentAvailableInClient', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
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

  it('bloqueia quando já existe cadastro pendente no mesmo cliente', async () => {
    jest
      .spyOn(membersQueries, 'findMemberByNormalizedDocument')
      .mockResolvedValue(null);
    jest
      .spyOn(
        registrationsQueries,
        'findPendingRegistrationByNormalizedDocument',
      )
      .mockResolvedValue({ id: 'reg-1' } as never);

    await expect(
      assertDocumentAvailableInClient(db, 'client-1', '52998224725'),
    ).rejects.toThrow(DOCUMENT_ALREADY_PENDING_MESSAGE);
  });

  it('libera o mesmo documento em outro cliente (queries recebem o clientId)', async () => {
    const memberSpy = jest
      .spyOn(membersQueries, 'findMemberByNormalizedDocument')
      .mockResolvedValue(null);
    const pendingSpy = jest
      .spyOn(
        registrationsQueries,
        'findPendingRegistrationByNormalizedDocument',
      )
      .mockResolvedValue(null);

    await assertDocumentAvailableInClient(db, 'other-client', CPF);

    expect(memberSpy).toHaveBeenCalledWith(
      db,
      'other-client',
      '52998224725',
      undefined,
    );
    expect(pendingSpy).toHaveBeenCalledWith(
      db,
      'other-client',
      '52998224725',
      undefined,
    );
  });

  it('exclui o próprio membro no update', async () => {
    const memberSpy = jest
      .spyOn(membersQueries, 'findMemberByNormalizedDocument')
      .mockResolvedValue(null);
    jest
      .spyOn(
        registrationsQueries,
        'findPendingRegistrationByNormalizedDocument',
      )
      .mockResolvedValue(null);

    await assertDocumentAvailableInClient(db, 'client-1', CPF, {
      excludeMemberId: 'member-self',
    });

    expect(memberSpy).toHaveBeenCalledWith(
      db,
      'client-1',
      '52998224725',
      'member-self',
    );
  });

  it('não consulta pendentes quando checkPending é false', async () => {
    jest
      .spyOn(membersQueries, 'findMemberByNormalizedDocument')
      .mockResolvedValue(null);
    const pendingSpy = jest.spyOn(
      registrationsQueries,
      'findPendingRegistrationByNormalizedDocument',
    );

    await assertDocumentAvailableInClient(db, 'client-1', CPF, {
      checkPending: false,
    });

    expect(pendingSpy).not.toHaveBeenCalled();
  });
});
