import AxiosDigestAuth from '@mhoc/axios-digest-auth';

import type { ReaderFaceSyncRow } from '../database/queries/readers.queries';
import {
  DEFAULT_INTELBRAS_VALID_DATE_END,
  DEFAULT_INTELBRAS_VALID_DATE_START,
} from './intelbras-valid-date.util';
import { normalizeNameForFacialReader } from './normalize-name-for-reader';

export type PlainReaderCredential = {
  id: string;
  name: string;
  ip: string;
  port: number;
  username: string;
  plainPassword: string;
};

export function toPlainReaderCredential(
  row: ReaderFaceSyncRow,
  decryptedPassword: string,
): PlainReaderCredential {
  return {
    id: row.id,
    name: row.name,
    ip: row.ip.trim(),
    port: row.port ?? 80,
    username: row.username.trim(),
    plainPassword: decryptedPassword,
  };
}

function deviceUrl(reader: PlainReaderCredential): string {
  const port = reader.port ?? 80;
  return port === 80
    ? `http://${reader.ip}`
    : `http://${reader.ip}:${port}`;
}

type ApiDigestResponse = { status?: number; data?: unknown };

function stripDataUriBase64(raw: string): string {
  return raw.replace(/^data:image\/[a-z+]+;base64,/, '');
}

async function digestRequest(
  auth: AxiosDigestAuth,
  init: {
    method: 'GET' | 'POST';
    url: string;
    data?: Record<string, unknown>;
    headers?: Record<string, string>;
  },
): Promise<ApiDigestResponse> {
  return auth.request(init) as Promise<ApiDigestResponse>;
}

/**
 * Cria/atualiza cartão de acesso e envia a foto ao leitor Intelbras/Dahua (CGI + Digest).
 */
export async function intelbrasUpsertFaceOnReader(
  reader: PlainReaderCredential,
  faceIdNumeric: number,
  displayName: string,
  rawBase64: string,
): Promise<void> {
  const normalizedName =
    normalizeNameForFacialReader(displayName.trim() || 'USUARIO') || 'USUARIO';
  const auth = new AxiosDigestAuth({
    username: reader.username,
    password: reader.plainPassword,
  });

  const base = deviceUrl(reader);
  const faceId = String(faceIdNumeric);
  const cleanBase64 = stripDataUriBase64(rawBase64).trim();

  const decBytes = Buffer.from(cleanBase64, 'base64').length;
  if (decBytes > 100 * 1024) {
    throw new Error(
      `Arquivo muito grande (${(decBytes / 1024).toFixed(1)} KB). Limite: 100 KB`,
    );
  }

  const checkUserUrl = `${base}/cgi-bin/AccessUser.cgi?action=list&UserIDList[0]=${faceId}`;
  let userExists = false;
  try {
    const r = await digestRequest(auth, { method: 'GET', url: checkUserUrl });
    userExists = (r.status ?? 0) >= 200 && (r.status ?? 0) < 300;
  } catch {
    userExists = false;
  }

  if (!userExists) {
    const qsStart = encodeURIComponent(DEFAULT_INTELBRAS_VALID_DATE_START);
    const qsEnd = encodeURIComponent(DEFAULT_INTELBRAS_VALID_DATE_END);
    const createUserUrl =
      `${base}/cgi-bin/recordUpdater.cgi?action=insert&name=AccessControlCard` +
      `&CardName=${encodeURIComponent(normalizedName)}&CardNo=${faceId}&UserID=${faceId}&CardStatus=0&UserType=0&Authority=2&Doors=[0]&TimeSections=[255]&ValidDateStart=${qsStart}&ValidDateEnd=${qsEnd}`;
    await digestRequest(auth, { method: 'GET', url: createUserUrl });
  }

  const checkFaceUrl = `${base}/cgi-bin/FaceInfoManager.cgi?action=startFind&Condition.UserID=${faceId}`;
  let faceExists = false;
  try {
    const faceResp = await digestRequest(auth, { method: 'GET', url: checkFaceUrl });
    const payload = faceResp.data as { Total?: number } | undefined;
    if (
      payload &&
      typeof payload === 'object' &&
      payload.Total !== undefined &&
      Number(payload.Total) > 0
    ) {
      faceExists = true;
    }
  } catch {
    faceExists = false;
  }

  const action = faceExists ? 'updateMulti' : 'insertMulti';
  const faceUrl = `${base}/cgi-bin/AccessFace.cgi?action=${action}`;
  await digestRequest(auth, {
    method: 'POST',
    url: faceUrl,
    data: {
      FaceList: [{ UserID: faceId, PhotoData: [cleanBase64] }],
    },
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function intelbrasRemoveUserFromReader(
  reader: PlainReaderCredential,
  faceIdNumeric: number,
): Promise<void> {
  const auth = new AxiosDigestAuth({
    username: reader.username,
    password: reader.plainPassword,
  });
  const faceId = String(faceIdNumeric);
  const base = deviceUrl(reader);
  const url = `${base}/cgi-bin/AccessUser.cgi?action=removeMulti&UserIDList[0]=${faceId}`;
  await digestRequest(auth, { method: 'GET', url });
}
