import type { HikvisionReaderConnection } from './hikvision-connection.types';
import { hikvisionIsapiRequest } from './hikvision-isapi-request';
import {
  DEFAULT_HIKVISION_VALID_DATE_END,
  DEFAULT_HIKVISION_VALID_DATE_START,
} from './hikvision-valid-date.util';
import {
  extractResponseStatus,
  extractSubStatusCode,
  FACE_LIB_NOT_FOUND_CODES,
  hikvisionFaceErrorMessage,
  isFaceAlreadyExistsError,
  isFaceModelingError,
  isHikvisionSuccess,
  isUserNotFoundError,
  USER_ALREADY_EXISTS_CODES,
} from './hikvision-error.util';
import {
  normalizeHikvisionFaceJpeg,
  detectImageFormat,
} from '../../face-sync/hikvision-face-image.util';
import { normalizeNameForFacialReader } from '../../face-sync/normalize-name-for-reader';
import {
  syncLog,
  syncLogError,
  truncateForLog,
} from '../../face-sync/intelbras-sync-debug.util';

export const HIKVISION_FACE_LIB_TYPE = 'blackFD';
export const HIKVISION_FACE_FDID = '1';
export const HIKVISION_MAX_FACE_IMAGE_BYTES = 200 * 1024;

export type HikvisionFaceLibRef = {
  fdid: string;
  faceLibType: string;
};

const faceLibCache = new Map<string, HikvisionFaceLibRef>();

export type HikvisionUpsertUserParams = {
  employeeNo: string;
  name: string;
  validDateStart?: string;
  validDateEnd?: string;
};

type AxiosLikeError = {
  message?: string;
  response?: {
    status?: number;
    data?: unknown;
  };
};

export type HikvisionDeviceUser = {
  userId: string;
  name: string;
  cardNo: string | null;
  validFrom: string | null;
  validTo: string | null;
  hasFace?: boolean;
};

export type HikvisionDeviceUsersListResult = {
  totalCount: number;
  found: number;
  records: HikvisionDeviceUser[];
};

function buildUserInfoBody(
  params: HikvisionUpsertUserParams,
): Record<string, unknown> {
  const beginTime = params.validDateStart ?? DEFAULT_HIKVISION_VALID_DATE_START;
  const endTime = params.validDateEnd ?? DEFAULT_HIKVISION_VALID_DATE_END;

  return {
    UserInfo: {
      employeeNo: params.employeeNo,
      name: params.name,
      userType: 'normal',
      Valid: {
        enable: true,
        beginTime,
        endTime,
        timeType: 'local',
      },
      doorRight: '1',
      RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
      userVerifyMode: 'face',
    },
  };
}

function userInfoRecordUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
): string {
  return `${connection.baseUrl}/ISAPI/AccessControl/UserInfo/Record?format=json`;
}

function userInfoModifyUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
): string {
  return `${connection.baseUrl}/ISAPI/AccessControl/UserInfo/Modify?format=json`;
}

function userInfoDeleteUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
): string {
  return `${connection.baseUrl}/ISAPI/AccessControl/UserInfo/Delete?format=json`;
}

function faceDataRecordUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
): string {
  return `${connection.baseUrl}/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json`;
}

function faceSetupUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
): string {
  return `${connection.baseUrl}/ISAPI/Intelligent/FDLib/FDSetUp?format=json`;
}

function faceLibListUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
): string {
  return `${connection.baseUrl}/ISAPI/Intelligent/FDLib?format=json`;
}

function fdLibCacheKey(connection: HikvisionReaderConnection): string {
  return connection.baseUrl;
}

function parseFdLibEntry(
  item: Record<string, unknown>,
): HikvisionFaceLibRef | null {
  const fdid = pickStr(item, 'FDID', 'fdid', 'id');
  const faceLibType = pickStr(item, 'faceLibType', 'FaceLibType', 'type');
  if (!fdid || !faceLibType) {
    return null;
  }
  return { fdid, faceLibType };
}

function parseFdLibList(data: unknown): HikvisionFaceLibRef[] {
  const root = asRecord(data);
  if (!root) {
    return [];
  }

  const raw = root.FDLib ?? root.fdLib ?? root.FaceLibrary;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const libs: HikvisionFaceLibRef[] = [];

  for (const item of items) {
    const rec = asRecord(item);
    if (!rec) {
      continue;
    }
    const parsed = parseFdLibEntry(rec);
    if (parsed) {
      libs.push(parsed);
    }
  }

  return libs;
}

export function chooseFaceLib(
  libs: HikvisionFaceLibRef[],
): HikvisionFaceLibRef {
  const black = libs.find((lib) => lib.faceLibType === 'blackFD');
  if (black) {
    return black;
  }

  const white = libs.find((lib) => lib.faceLibType === 'whiteFD');
  if (white) {
    return white;
  }

  const first = libs.find((lib) => lib.fdid.trim());
  if (first) {
    return first;
  }

  return {
    fdid: HIKVISION_FACE_FDID,
    faceLibType: HIKVISION_FACE_LIB_TYPE,
  };
}

export async function resolveHikvisionFaceLib(
  connection: HikvisionReaderConnection,
): Promise<HikvisionFaceLibRef> {
  const key = fdLibCacheKey(connection);
  const cached = faceLibCache.get(key);
  if (cached) {
    return cached;
  }

  try {
    const response = await hikvisionIsapiRequest(connection, {
      method: 'GET',
      url: faceLibListUrl(connection),
    });
    const chosen = chooseFaceLib(parseFdLibList(response.data));
    faceLibCache.set(key, chosen);
    return chosen;
  } catch {
    const fallback: HikvisionFaceLibRef = {
      fdid: HIKVISION_FACE_FDID,
      faceLibType: HIKVISION_FACE_LIB_TYPE,
    };
    faceLibCache.set(key, fallback);
    return fallback;
  }
}

function faceLibCreateUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
): string {
  return faceLibListUrl(connection);
}

export type HikvisionFaceMultipartFieldName = 'FaceImage' | 'img';

export type BuildHikvisionFaceMultipartOptions = {
  imageFieldName?: HikvisionFaceMultipartFieldName;
  imageFilename?: string;
};

export function buildHikvisionFaceMultipartBody(
  employeeNo: string,
  jpegBuffer: Buffer,
  faceLib: HikvisionFaceLibRef,
  options: BuildHikvisionFaceMultipartOptions = {},
): {
  body: Buffer;
  contentType: string;
  imageFieldName: HikvisionFaceMultipartFieldName;
} {
  const imageFieldName = options.imageFieldName ?? 'FaceImage';
  const imageFilename = options.imageFilename ?? 'face.jpg';

  const meta = JSON.stringify({
    faceLibType: faceLib.faceLibType,
    FDID: faceLib.fdid,
    FPID: employeeNo,
  });

  const boundary = `----hik${Date.now().toString(16)}`;
  const CRLF = '\r\n';

  const head =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="FaceDataRecord";${CRLF}` +
    `Content-Type: application/json${CRLF}` +
    `Content-Length: ${Buffer.byteLength(meta)}${CRLF}${CRLF}${meta}` +
    `${CRLF}--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="${imageFieldName}"; filename="${imageFilename}"${CRLF}` +
    `Content-Type: image/jpeg${CRLF}` +
    `Content-Length: ${jpegBuffer.length}${CRLF}${CRLF}`;

  const tail = `${CRLF}--${boundary}--${CRLF}`;
  const body = Buffer.concat([
    Buffer.from(head),
    jpegBuffer,
    Buffer.from(tail),
  ]);

  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    imageFieldName,
  };
}

async function sendHikvisionFaceMultipart(
  connection: HikvisionReaderConnection,
  method: 'POST' | 'PUT',
  url: string,
  employeeNo: string,
  jpegBuffer: Buffer,
  imageFieldName: HikvisionFaceMultipartFieldName,
  faceLib: HikvisionFaceLibRef,
): Promise<void> {
  const { body, contentType } = buildHikvisionFaceMultipartBody(
    employeeNo,
    jpegBuffer,
    faceLib,
    { imageFieldName },
  );

  syncLog('hikvision:upsertFaceRequest', {
    employeeNo,
    method,
    url,
    imageFieldName,
    jpegBytes: jpegBuffer.length,
    faceLibType: faceLib.faceLibType,
    fdid: faceLib.fdid,
  });

  const response = await hikvisionIsapiRequest(connection, {
    method,
    url,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.length),
    },
    data: body,
    transformRequest: [(data: unknown) => data],
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const status = extractResponseStatus(response.data);
  syncLog('hikvision:upsertFaceResponse', {
    employeeNo,
    method,
    statusCode: status?.statusCode,
    subStatusCode: status?.subStatusCode,
    body: truncateForLog(response.data),
  });

  if (!isHikvisionSuccess(response.data)) {
    const syntheticError: AxiosLikeError = {
      message:
        status?.subStatusCode ?? status?.statusString ?? 'Falha ao gravar face',
      response: { data: response.data },
    };
    throw syntheticError;
  }
}

async function postUserInfoRecord(
  connection: HikvisionReaderConnection,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await hikvisionIsapiRequest(connection, {
    method: 'POST',
    url: userInfoRecordUrl(connection),
    headers: { 'Content-Type': 'application/json' },
    data: body,
  });

  if (!isHikvisionSuccess(response.data)) {
    const status = extractResponseStatus(response.data);
    syncLog('hikvision:upsertUserResponse', {
      method: 'POST',
      employeeNo: (body.UserInfo as Record<string, unknown> | undefined)
        ?.employeeNo,
      statusCode: status?.statusCode,
      subStatusCode: status?.subStatusCode,
      body: truncateForLog(response.data),
    });
    const syntheticError: AxiosLikeError = {
      message:
        status?.subStatusCode ??
        status?.statusString ??
        'Falha ao criar usuário',
      response: { data: response.data },
    };
    throw syntheticError;
  }

  syncLog('hikvision:upsertUserResponse', {
    method: 'POST',
    employeeNo: (body.UserInfo as Record<string, unknown> | undefined)
      ?.employeeNo,
    ok: true,
    body: truncateForLog(response.data),
  });
}

async function putUserInfoModify(
  connection: HikvisionReaderConnection,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await hikvisionIsapiRequest(connection, {
    method: 'PUT',
    url: userInfoModifyUrl(connection),
    headers: { 'Content-Type': 'application/json' },
    data: body,
  });

  if (!isHikvisionSuccess(response.data)) {
    const status = extractResponseStatus(response.data);
    syncLog('hikvision:upsertUserResponse', {
      method: 'PUT',
      employeeNo: (body.UserInfo as Record<string, unknown> | undefined)
        ?.employeeNo,
      statusCode: status?.statusCode,
      subStatusCode: status?.subStatusCode,
      body: truncateForLog(response.data),
    });
    const syntheticError: AxiosLikeError = {
      message:
        status?.subStatusCode ??
        status?.statusString ??
        'Falha ao atualizar usuário',
      response: { data: response.data },
    };
    throw syntheticError;
  }

  syncLog('hikvision:upsertUserResponse', {
    method: 'PUT',
    employeeNo: (body.UserInfo as Record<string, unknown> | undefined)
      ?.employeeNo,
    ok: true,
    body: truncateForLog(response.data),
  });
}

export async function hikvisionUpsertUser(
  connection: HikvisionReaderConnection,
  params: HikvisionUpsertUserParams,
): Promise<void> {
  const body = buildUserInfoBody(params);

  try {
    await postUserInfoRecord(connection, body);
  } catch (error) {
    const subStatusCode = extractSubStatusCode(error);
    if (subStatusCode && USER_ALREADY_EXISTS_CODES.has(subStatusCode)) {
      await putUserInfoModify(connection, body);
      return;
    }
    throw error;
  }
}

async function hikvisionCreateFaceLibrary(
  connection: HikvisionReaderConnection,
): Promise<void> {
  const response = await hikvisionIsapiRequest(connection, {
    method: 'POST',
    url: faceLibCreateUrl(connection),
    headers: { 'Content-Type': 'application/xml' },
    data:
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<FaceLibrary><id>1</id><name>face2go</name><type>blackFD</type></FaceLibrary>',
  });

  if (!isHikvisionSuccess(response.data)) {
    const status = extractResponseStatus(response.data);
    const syntheticError: AxiosLikeError = {
      message:
        status?.subStatusCode ??
        status?.statusString ??
        'Falha ao criar biblioteca de faces',
      response: { data: response.data },
    };
    throw syntheticError;
  }

  faceLibCache.delete(fdLibCacheKey(connection));
}

async function hikvisionPostFaceDataRecord(
  connection: HikvisionReaderConnection,
  employeeNo: string,
  jpegBuffer: Buffer,
  faceLib: HikvisionFaceLibRef,
): Promise<void> {
  try {
    await hikvisionPostFaceDataRecordOnce(
      connection,
      employeeNo,
      jpegBuffer,
      'FaceImage',
      faceLib,
    );
  } catch (firstError) {
    if (isFaceAlreadyExistsError(firstError)) {
      throw firstError;
    }
    await hikvisionPostFaceDataRecordOnce(
      connection,
      employeeNo,
      jpegBuffer,
      'img',
      faceLib,
    );
  }
}

export async function hikvisionUpsertFace(
  connection: HikvisionReaderConnection,
  employeeNo: string,
  jpegBuffer: Buffer,
): Promise<void> {
  const inputFormat = detectImageFormat(jpegBuffer);
  syncLog('hikvision:normalizeFaceInput', {
    employeeNo,
    inputFormat,
    inputBytes: jpegBuffer.length,
  });

  let normalized: Buffer;
  try {
    normalized = await normalizeHikvisionFaceJpeg(jpegBuffer);
  } catch (error) {
    syncLogError('hikvision:normalizeFace', error, {
      employeeNo,
      inputFormat,
      inputBytes: jpegBuffer.length,
    });
    throw error;
  }

  syncLog('hikvision:normalizeFaceOk', {
    employeeNo,
    inputFormat,
    outputBytes: normalized.length,
  });

  if (normalized.length > HIKVISION_MAX_FACE_IMAGE_BYTES) {
    throw new Error(
      `Arquivo muito grande (${(normalized.length / 1024).toFixed(2)} KB). Limite: 200KB`,
    );
  }

  const faceLib = await resolveHikvisionFaceLib(connection);
  syncLog('hikvision:fdLib', {
    employeeNo,
    fdid: faceLib.fdid,
    faceLibType: faceLib.faceLibType,
  });

  try {
    await hikvisionPostFaceDataRecord(
      connection,
      employeeNo,
      normalized,
      faceLib,
    );
  } catch (error) {
    if (isFaceAlreadyExistsError(error)) {
      syncLog('hikvision:upsertFaceFallback', {
        employeeNo,
        reason: 'faceAlreadyExists',
        method: 'PUT',
      });
      await hikvisionPutFaceSetup(connection, employeeNo, normalized, faceLib);
    } else {
      const subStatusCode = extractSubStatusCode(error);
      if (subStatusCode && FACE_LIB_NOT_FOUND_CODES.has(subStatusCode)) {
        await hikvisionCreateFaceLibrary(connection);
        const refreshedLib = await resolveHikvisionFaceLib(connection);
        await hikvisionPostFaceDataRecord(
          connection,
          employeeNo,
          normalized,
          refreshedLib,
        );
      } else if (isFaceModelingError(error)) {
        syncLog('hikvision:upsertFaceFallback', {
          employeeNo,
          reason: 'faceModelingError',
          method: 'PUT',
        });
        await hikvisionPutFaceSetup(
          connection,
          employeeNo,
          normalized,
          faceLib,
        );
      } else {
        syncLogError('hikvision:upsertFace', error, {
          employeeNo,
          subStatusCode: extractSubStatusCode(error),
        });
        throw error;
      }
    }
  }

  const verifyLib = await resolveHikvisionFaceLib(connection);
  await hikvisionVerifyUserHasFace(connection, employeeNo, verifyLib);
}

async function hikvisionPutFaceSetupOnce(
  connection: HikvisionReaderConnection,
  employeeNo: string,
  jpegBuffer: Buffer,
  imageFieldName: HikvisionFaceMultipartFieldName,
  faceLib: HikvisionFaceLibRef,
): Promise<void> {
  await sendHikvisionFaceMultipart(
    connection,
    'PUT',
    faceSetupUrl(connection),
    employeeNo,
    jpegBuffer,
    imageFieldName,
    faceLib,
  );
}

async function hikvisionPostFaceDataRecordOnce(
  connection: HikvisionReaderConnection,
  employeeNo: string,
  jpegBuffer: Buffer,
  imageFieldName: HikvisionFaceMultipartFieldName,
  faceLib: HikvisionFaceLibRef,
): Promise<void> {
  await sendHikvisionFaceMultipart(
    connection,
    'POST',
    faceDataRecordUrl(connection),
    employeeNo,
    jpegBuffer,
    imageFieldName,
    faceLib,
  );
}

async function hikvisionPutFaceSetup(
  connection: HikvisionReaderConnection,
  employeeNo: string,
  jpegBuffer: Buffer,
  faceLib: HikvisionFaceLibRef,
): Promise<void> {
  try {
    await hikvisionPutFaceSetupOnce(
      connection,
      employeeNo,
      jpegBuffer,
      'img',
      faceLib,
    );
  } catch (firstError) {
    if (isFaceAlreadyExistsError(firstError)) {
      throw firstError;
    }
    await hikvisionPutFaceSetupOnce(
      connection,
      employeeNo,
      jpegBuffer,
      'FaceImage',
      faceLib,
    );
  }
}

export async function hikvisionDeleteUser(
  connection: HikvisionReaderConnection,
  employeeNo: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await hikvisionIsapiRequest(connection, {
      method: 'PUT',
      url: userInfoDeleteUrl(connection),
      headers: { 'Content-Type': 'application/json' },
      data: {
        UserInfoDelCond: {
          EmployeeNoList: [{ employeeNo }],
        },
      },
    });

    if (isHikvisionSuccess(response.data)) {
      return { success: true };
    }

    const status = extractResponseStatus(response.data);
    return {
      success: false,
      error:
        status?.subStatusCode ??
        status?.statusString ??
        'Falha ao deletar usuário Hikvision',
    };
  } catch (error) {
    if (isUserNotFoundError(error)) {
      return { success: true };
    }
    return {
      success: false,
      error: hikvisionFaceErrorMessage(error),
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickStr(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) {
      return v.trim();
    }
  }
  return undefined;
}

function mapHikvisionUserInfo(
  item: Record<string, unknown>,
): HikvisionDeviceUser | null {
  const userId = String(item.employeeNo ?? item.EmployeeNo ?? '').trim();
  if (!userId) {
    return null;
  }

  const valid = asRecord(item.Valid) ?? asRecord(item.valid);
  const numOfFace = item.numOfFace ?? item.NumOfFace;
  const hasFace =
    typeof numOfFace === 'number'
      ? numOfFace > 0
      : typeof numOfFace === 'string'
        ? Number(numOfFace) > 0
        : undefined;

  return {
    userId,
    name: String(item.name ?? item.Name ?? userId).trim() || userId,
    cardNo: null,
    validFrom: pickStr(valid ?? {}, 'beginTime', 'BeginTime') ?? null,
    validTo: pickStr(valid ?? {}, 'endTime', 'EndTime') ?? null,
    hasFace,
  };
}

function userInfoSearchUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
): string {
  return `${connection.baseUrl}/ISAPI/AccessControl/UserInfo/Search?format=json`;
}

function parseUserInfoSearchItems(
  search: Record<string, unknown>,
): Record<string, unknown>[] {
  const infoList = search.UserInfo;
  if (Array.isArray(infoList)) {
    return infoList.filter(
      (item): item is Record<string, unknown> =>
        item != null && typeof item === 'object',
    );
  }
  if (infoList && typeof infoList === 'object') {
    return [infoList as Record<string, unknown>];
  }
  return [];
}

export function parseUserInfoSearchPage(
  data: unknown,
): HikvisionDeviceUsersListResult {
  const root = asRecord(data);
  const search = asRecord(root?.UserInfoSearch) ?? root ?? {};
  const items = parseUserInfoSearchItems(search);
  const records: HikvisionDeviceUser[] = [];

  for (const item of items) {
    if (item && typeof item === 'object') {
      const mapped = mapHikvisionUserInfo(item);
      if (mapped) {
        records.push(mapped);
      }
    }
  }

  const statusStr = String(search.responseStatusStrg ?? '').toUpperCase();
  const totalMatchesRaw = search.totalMatches ?? search.numOfMatches;
  const totalMatches = Number(totalMatchesRaw);
  const totalCount =
    statusStr === 'NO MATCH'
      ? 0
      : Number.isFinite(totalMatches) && totalMatches >= 0
        ? totalMatches
        : records.length;

  return {
    totalCount,
    found: records.length,
    records,
  };
}

async function fetchUserInfoSearchPage(
  connection: HikvisionReaderConnection,
  params: {
    limit: number;
    offset: number;
    fuzzySearch?: string;
    employeeNo?: string;
  },
): Promise<HikvisionDeviceUsersListResult> {
  const safeLimit = Math.min(Math.max(params.limit, 1), 500);
  const safeOffset = Math.max(params.offset, 0);

  const cond: Record<string, unknown> = {
    searchID: `face2go-${Date.now()}-${safeOffset}`,
    searchResultPosition: safeOffset,
    maxResults: safeLimit,
  };

  const fuzzy = params.fuzzySearch?.trim();
  if (fuzzy) {
    cond.fuzzySearch = fuzzy;
  }
  if (params.employeeNo) {
    cond.EmployeeNoList = [{ employeeNo: params.employeeNo }];
  }

  const response = await hikvisionIsapiRequest(connection, {
    method: 'POST',
    url: userInfoSearchUrl(connection),
    headers: { 'Content-Type': 'application/json' },
    data: { UserInfoSearchCond: cond },
  });

  if (!isHikvisionSuccess(response.data)) {
    const status = extractResponseStatus(response.data);
    const syntheticError: AxiosLikeError = {
      message:
        status?.subStatusCode ??
        status?.statusString ??
        'Falha ao listar usuários Hikvision',
      response: { data: response.data },
    };
    throw syntheticError;
  }

  return parseUserInfoSearchPage(response.data);
}

/** Variantes de caixa para fuzzySearch quando o firmware exige match exato. */
export function buildFuzzySearchCaseVariants(term: string): string[] {
  const trimmed = term.trim();
  if (!trimmed) {
    return [];
  }

  const variants = new Set<string>();
  variants.add(trimmed);
  variants.add(trimmed.toUpperCase());
  variants.add(trimmed.toLowerCase());
  variants.add(
    trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase(),
  );
  variants.add(trimmed.replace(/\b\w/g, (char) => char.toUpperCase()));

  return [...variants];
}

/** Lista usuários paginados diretamente no dispositivo (ISAPI UserInfo/Search). */
export async function hikvisionGetDeviceUsers(
  connection: HikvisionReaderConnection,
  limit: number,
  offset: number,
  search?: string,
): Promise<HikvisionDeviceUsersListResult> {
  const term = search?.trim();
  if (term) {
    return hikvisionSearchDeviceUsers(connection, term, limit, offset);
  }
  return fetchUserInfoSearchPage(connection, { limit, offset });
}

export async function hikvisionSearchDeviceUsers(
  connection: HikvisionReaderConnection,
  search: string,
  limit: number,
  offset: number,
): Promise<HikvisionDeviceUsersListResult> {
  const term = search.trim();
  if (!term) {
    return fetchUserInfoSearchPage(connection, { limit, offset });
  }

  try {
    const first = await fetchUserInfoSearchPage(connection, {
      limit,
      offset,
      fuzzySearch: term,
    });
    if (first.found > 0) {
      return first;
    }

    for (const variant of buildFuzzySearchCaseVariants(term)) {
      if (variant === term) {
        continue;
      }
      const variantResult = await fetchUserInfoSearchPage(connection, {
        limit,
        offset,
        fuzzySearch: variant,
      });
      if (variantResult.found > 0) {
        return variantResult;
      }
    }

    return first;
  } catch (error) {
    const subStatusCode = extractSubStatusCode(error);
    const message = hikvisionFaceErrorMessage(error);
    if (
      subStatusCode ||
      /fuzzy|search|invalid|unsupported|not support/i.test(message)
    ) {
      throw new Error(
        'Busca por nome não suportada neste leitor Hikvision. Use o ID do usuário ou atualize o firmware.',
      );
    }
    throw error;
  }
}

async function hikvisionGetUserInfoByEmployeeNo(
  connection: HikvisionReaderConnection,
  employeeNo: string,
): Promise<HikvisionDeviceUser | null> {
  const page = await fetchUserInfoSearchPage(connection, {
    limit: 1,
    offset: 0,
    employeeNo,
  });
  return page.records[0] ?? null;
}

export function assertHikvisionEmployeeNoMatch(
  user: HikvisionDeviceUser | null,
  employeeNo: string,
): HikvisionDeviceUser {
  if (!user) {
    throw new Error('Usuário não encontrado no leitor após sincronização.');
  }
  if (user.userId !== employeeNo) {
    throw new Error(
      `Busca no leitor não retornou employeeNo ${employeeNo} (retornou ${user.userId}).`,
    );
  }
  return user;
}

export async function hikvisionVerifyUserHasFace(
  connection: HikvisionReaderConnection,
  employeeNo: string,
  faceLib?: HikvisionFaceLibRef,
): Promise<void> {
  const lib = faceLib ?? (await resolveHikvisionFaceLib(connection));
  const user = assertHikvisionEmployeeNoMatch(
    await hikvisionGetUserInfoByEmployeeNo(connection, employeeNo),
    employeeNo,
  );

  const fdSearch = await hikvisionSearchFace(connection, employeeNo, lib);
  const pictureUrl = findPictureUrlInPayload(fdSearch);

  if (pictureUrl) {
    syncLog('hikvision:verifyFace', {
      employeeNo,
      userId: user.userId,
      numOfFace: user.hasFace ?? null,
      fdSearch: 'ok',
      fdSearchBody: truncateForLog(fdSearch),
    });
    return;
  }

  if (user.hasFace === true) {
    syncLog('hikvision:verifyFace', {
      employeeNo,
      userId: user.userId,
      numOfFace: true,
      fdSearch: 'miss',
      fdSearchBody: truncateForLog(fdSearch),
    });
    return;
  }

  syncLog('hikvision:verifyFace', {
    employeeNo,
    userId: user.userId,
    numOfFace: user.hasFace ?? false,
    fdSearch: 'miss',
    fdSearchBody: truncateForLog(fdSearch),
  });
  throw new Error(`Face não gravada no leitor para employeeNo ${employeeNo}.`);
}

export async function hikvisionSearchFace(
  connection: HikvisionReaderConnection,
  employeeNo: string,
  faceLib?: HikvisionFaceLibRef,
): Promise<unknown> {
  const lib = faceLib ?? (await resolveHikvisionFaceLib(connection));

  const response = await hikvisionIsapiRequest(connection, {
    method: 'POST',
    url: `${connection.baseUrl}/ISAPI/Intelligent/FDLib/FDSearch?format=json`,
    headers: { 'Content-Type': 'application/json' },
    data: {
      searchResultPosition: 0,
      maxResults: 1,
      faceLibType: lib.faceLibType,
      FDID: lib.fdid,
      FPID: employeeNo,
    },
  });

  return response.data;
}

function extractUrlFromUnknown(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

function findPictureUrlInPayload(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  const direct =
    extractUrlFromUnknown(root.pictureURL) ??
    extractUrlFromUnknown(root.faceURL) ??
    extractUrlFromUnknown(root.PictureURL) ??
    extractUrlFromUnknown(root.FaceURL);

  if (direct) {
    return direct;
  }

  const matchList = root.MatchList ?? root.matchList;
  const matches = Array.isArray(matchList)
    ? matchList
    : matchList
      ? [matchList]
      : [];

  for (const match of matches) {
    const m = asRecord(match);
    const url =
      extractUrlFromUnknown(m?.pictureURL) ??
      extractUrlFromUnknown(m?.faceURL) ??
      extractUrlFromUnknown(m?.PictureURL);
    if (url) {
      return url;
    }
  }

  return null;
}

export async function hikvisionGetFaceImage(
  connection: HikvisionReaderConnection,
  employeeNo: string,
): Promise<{ photoBase64: string | null }> {
  const fdSearch = await hikvisionSearchFace(connection, employeeNo);
  let pictureUrl = findPictureUrlInPayload(fdSearch);

  if (!pictureUrl) {
    const userSearch = await hikvisionIsapiRequest(connection, {
      method: 'POST',
      url: userInfoSearchUrl(connection),
      headers: { 'Content-Type': 'application/json' },
      data: {
        UserInfoSearchCond: {
          searchID: `face2go-face-${Date.now()}`,
          searchResultPosition: 0,
          maxResults: 1,
          EmployeeNoList: [{ employeeNo }],
        },
      },
    });

    const searchRoot = asRecord(userSearch.data);
    const search = asRecord(searchRoot?.UserInfoSearch) ?? searchRoot;
    const infoList = search?.UserInfo;
    const first = Array.isArray(infoList) ? infoList[0] : infoList;
    const info = asRecord(first);
    pictureUrl =
      extractUrlFromUnknown(info?.faceURL) ??
      extractUrlFromUnknown(info?.FaceURL) ??
      null;
  }

  if (!pictureUrl) {
    return { photoBase64: null };
  }

  const absoluteUrl = pictureUrl.startsWith('http')
    ? pictureUrl
    : `${connection.baseUrl}${pictureUrl.startsWith('/') ? '' : '/'}${pictureUrl}`;

  try {
    const imageResponse = await hikvisionIsapiRequest(connection, {
      method: 'GET',
      url: absoluteUrl,
      responseType: 'arraybuffer',
    });
    const data = imageResponse.data;
    if (data instanceof Buffer) {
      return { photoBase64: data.toString('base64') };
    }
    if (data instanceof ArrayBuffer) {
      return { photoBase64: Buffer.from(data).toString('base64') };
    }
  } catch {
    return { photoBase64: null };
  }

  return { photoBase64: null };
}

export async function hikvisionSyncFace(
  connection: HikvisionReaderConnection,
  params: {
    employeeNo: string;
    personName: string;
    jpegBuffer: Buffer;
    validDateStart?: string;
    validDateEnd?: string;
  },
): Promise<void> {
  const normalizedName =
    normalizeNameForFacialReader(params.personName.trim() || 'USUARIO') ||
    'USUARIO';
  const employeeNo = params.employeeNo;

  try {
    syncLog('hikvision:upsertUser', { employeeNo });
    await hikvisionUpsertUser(connection, {
      employeeNo,
      name: normalizedName,
      validDateStart: params.validDateStart,
      validDateEnd: params.validDateEnd,
    });
    syncLog('hikvision:upsertUserOk', { employeeNo });

    syncLog('hikvision:upsertFace', { employeeNo });
    await hikvisionUpsertFace(connection, employeeNo, params.jpegBuffer);
    syncLog('hikvision:verifyFaceOk', { employeeNo });
  } catch (error) {
    syncLogError('hikvision:syncFace', error, { employeeNo });
    throw error;
  }
}
