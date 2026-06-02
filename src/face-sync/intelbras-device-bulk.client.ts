import AxiosDigestAuth from '@mhoc/axios-digest-auth';

import {
  DEFAULT_INTELBRAS_VALID_DATE_END,
  DEFAULT_INTELBRAS_VALID_DATE_START,
} from './intelbras-valid-date.util';
import type { PlainReaderCredential } from './intelbras-device.client';
import { normalizeNameForFacialReader } from './normalize-name-for-reader';
import { readerLabel, syncLog, syncLogError } from './intelbras-sync-debug.util';

export type IntelbrasUserRecord = {
  userId: string;
  userName: string;
  userType?: number;
  validFrom?: string;
  validTo?: string;
};

const READER_HTTP_TIMEOUT_MS = 10_000;
const MAX_USERS_PER_CALL = 10;

function deviceUrl(reader: PlainReaderCredential): string {
  const port = reader.port ?? 80;
  return port === 80
    ? `http://${reader.ip}`
    : `http://${reader.ip}:${port}`;
}

function toApiUserRecord(user: IntelbrasUserRecord) {
  return {
    UserID: user.userId,
    UserName:
      normalizeNameForFacialReader(user.userName.trim() || 'USUARIO') ||
      'USUARIO',
    UserType: user.userType ?? 0,
    ValidFrom: user.validFrom ?? DEFAULT_INTELBRAS_VALID_DATE_START,
    ValidTo: user.validTo ?? DEFAULT_INTELBRAS_VALID_DATE_END,
  };
}

async function digestJsonPost(
  reader: PlainReaderCredential,
  url: string,
  body: Record<string, unknown>,
): Promise<void> {
  const auth = new AxiosDigestAuth({
    username: reader.username,
    password: reader.plainPassword,
  });

  const response = (await auth.request({
    method: 'POST',
    url,
    data: body,
    headers: { 'Content-Type': 'application/json' },
    timeout: READER_HTTP_TIMEOUT_MS,
  } as Parameters<AxiosDigestAuth['request']>[0])) as { status?: number; data?: unknown };

  const status = response.status ?? 0;
  if (status >= 400) {
    throw new Error(`HTTP ${status}: ${String(response.data ?? 'erro')}`);
  }
}

function chunkUsers<T>(users: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < users.length; i += chunkSize) {
    chunks.push(users.slice(i, i + chunkSize));
  }
  return chunks;
}

/** POST /cgi-bin/AccessUser.cgi?action=insertMulti — até 10 usuários. */
export async function batchInsertUsersOnReader(
  reader: PlainReaderCredential,
  users: IntelbrasUserRecord[],
): Promise<void> {
  if (users.length === 0) return;
  if (users.length > MAX_USERS_PER_CALL) {
    throw new Error(`insertMulti aceita no máximo ${MAX_USERS_PER_CALL} usuários.`);
  }

  const label = readerLabel(reader);
  const base = deviceUrl(reader);
  const url = `${base}/cgi-bin/AccessUser.cgi?action=insertMulti`;

  syncLog('batchInsertUsers:inicio', { reader: label, count: users.length });

  try {
    await digestJsonPost(reader, url, {
      UserList: users.map(toApiUserRecord),
    });
    syncLog('batchInsertUsers:ok', { reader: label, count: users.length });
  } catch (err) {
    syncLogError('batchInsertUsers', err, { reader: label, count: users.length });
    throw err;
  }
}

/** POST /cgi-bin/AccessUser.cgi?action=updateMulti — até 10 usuários. */
export async function batchUpdateUsersOnReader(
  reader: PlainReaderCredential,
  users: IntelbrasUserRecord[],
): Promise<void> {
  if (users.length === 0) return;
  if (users.length > MAX_USERS_PER_CALL) {
    throw new Error(`updateMulti aceita no máximo ${MAX_USERS_PER_CALL} usuários.`);
  }

  const label = readerLabel(reader);
  const base = deviceUrl(reader);
  const url = `${base}/cgi-bin/AccessUser.cgi?action=updateMulti`;

  syncLog('batchUpdateUsers:inicio', { reader: label, count: users.length });

  try {
    await digestJsonPost(reader, url, {
      UserList: users.map(toApiUserRecord),
    });
    syncLog('batchUpdateUsers:ok', { reader: label, count: users.length });
  } catch (err) {
    syncLogError('batchUpdateUsers', err, { reader: label, count: users.length });
    throw err;
  }
}

/**
 * Tenta updateMulti; se falhar, insertMulti (usuários novos no leitor).
 * Repete em chunks de até 10.
 */
export async function batchUpsertUsersOnReader(
  reader: PlainReaderCredential,
  users: IntelbrasUserRecord[],
  chunkSize = MAX_USERS_PER_CALL,
): Promise<void> {
  const label = readerLabel(reader);
  syncLog('batchUpsertUsers:inicio', {
    reader: label,
    total: users.length,
    chunkSize,
  });

  for (const chunk of chunkUsers(users, chunkSize)) {
    let updated = false;
    try {
      await batchUpdateUsersOnReader(reader, chunk);
      updated = true;
    } catch (updateErr) {
      syncLogError('batchUpsertUsers:updateFalhou', updateErr, {
        reader: label,
        chunkSize: chunk.length,
      });
    }

    if (!updated) {
      await batchInsertUsersOnReader(reader, chunk);
    } else {
      try {
        await batchInsertUsersOnReader(reader, chunk);
      } catch (insertErr) {
        syncLogError('batchUpsertUsers:insertIgnorado', insertErr, {
          reader: label,
          chunkSize: chunk.length,
        });
      }
    }
  }

  syncLog('batchUpsertUsers:ok', { reader: label, total: users.length });
}
