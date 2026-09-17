import type { AppDb } from '../database/database.types';
import * as clientsQueries from '../database/queries/clients.queries';
import * as readersQueries from '../database/queries/readers.queries';
import {
  applyRestrictMinorsFieldRules,
  overrideFromResolved,
  resolveRegistrationFieldsConfig,
  type ResolvedRegistrationFieldsConfig,
} from './registration-fields-config';

export async function resolveFieldsConsideringRestrictMinors(
  db: AppDb,
  clientId: string,
  clientType: string,
  stored: unknown,
): Promise<{
  fields: ResolvedRegistrationFieldsConfig;
  birthDateRequiredByRestrictMinors: boolean;
}> {
  const hasRestrictMinorsReader =
    await readersQueries.hasRestrictMinorsReaderByClient(db, clientId);
  const base = resolveRegistrationFieldsConfig(clientType, stored);
  return {
    fields: applyRestrictMinorsFieldRules(base, hasRestrictMinorsReader),
    birthDateRequiredByRestrictMinors: hasRestrictMinorsReader,
  };
}

export async function persistBirthDateRequiredForClient(
  db: AppDb,
  clientId: string,
  clientType: string,
  stored: unknown,
) {
  const current = resolveRegistrationFieldsConfig(clientType, stored);
  const forced = applyRestrictMinorsFieldRules(current, true);
  const override = overrideFromResolved(clientType, forced);
  return clientsQueries.updateClientRegistrationConfig(db, clientId, override);
}
