import { ConflictException } from '@nestjs/common';

import { onlyDigits } from '../common/utils/document';
import type { AppDb } from '../database/database.types';
import * as membersQueries from '../database/queries/members.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';

export const DOCUMENT_ALREADY_MEMBER_MESSAGE =
  'Este CPF/CNPJ já está cadastrado neste cliente.';

export const DOCUMENT_ALREADY_PENDING_MESSAGE =
  'Já existe um cadastro em análise com este CPF/CNPJ.';

export async function assertDocumentAvailableInClient(
  db: AppDb,
  clientId: string,
  document: string | null | undefined,
  options: {
    excludeMemberId?: string;
    excludeRegistrationId?: string;
    checkPending?: boolean;
  } = {},
): Promise<void> {
  const digits = document ? onlyDigits(document) : '';
  if (!digits) return;

  const member = await membersQueries.findMemberByNormalizedDocument(
    db,
    clientId,
    digits,
    options.excludeMemberId,
  );
  if (member) {
    throw new ConflictException(DOCUMENT_ALREADY_MEMBER_MESSAGE);
  }

  if (options.checkPending === false) return;

  const pending =
    await registrationsQueries.findPendingRegistrationByNormalizedDocument(
      db,
      clientId,
      digits,
      options.excludeRegistrationId,
    );
  if (pending) {
    throw new ConflictException(DOCUMENT_ALREADY_PENDING_MESSAGE);
  }
}
