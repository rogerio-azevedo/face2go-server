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
  FACE_MODELING_ERROR_CODES,
  hikvisionFaceErrorMessage,
  isFaceAlreadyExistsError,
  isFaceModelingError,
  isHikvisionSuccess,
  isUserNotFoundError,
  USER_ALREADY_EXISTS_CODES,
} from './hikvision-error.util';
import { normalizeHikvisionFaceJpeg } from '../../face-sync/hikvision-face-image.util';
import { normalizeNameForFacialReader } from '../../face-sync/normalize-name-for-reader';

export const HIKVISION_FACE_LIB_TYPE = 'blackFD';
export const HIKVISION_FACE_FDID = '1';
export const HIKVISION_MAX_FACE_IMAGE_BYTES = 200 * 1024;

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

function faceLibCreateUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
): string {
  return `${connection.baseUrl}/ISAPI/Intelligent/FDLib?format=json`;
}

export type HikvisionFaceMultipartFieldName = 'FaceImage' | 'img';

export type BuildHikvisionFaceMultipartOptions = {
  imageFieldName?: HikvisionFaceMultipartFieldName;
  imageFilename?: string;
};

export function buildHikvisionFaceMultipartBody(
  employeeNo: string,
  jpegBuffer: Buffer,
  options: BuildHikvisionFaceMultipartOptions = {},
): {
  body: Buffer;
  contentType: string;
  imageFieldName: HikvisionFaceMultipartFieldName;
} {
  const imageFieldName = options.imageFieldName ?? 'FaceImage';
  const imageFilename = options.imageFilename ?? 'face.jpg';

  const meta = JSON.stringify({
    faceLibType: HIKVISION_FACE_LIB_TYPE,
    FDID: HIKVISION_FACE_FDID,
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
): Promise<void> {
  const { body, contentType } = buildHikvisionFaceMultipartBody(
    employeeNo,
    jpegBuffer,
    { imageFieldName },
  );

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

  if (!isHikvisionSuccess(response.data)) {
    const status = extractResponseStatus(response.data);
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
    const syntheticError: AxiosLikeError = {
      message:
        status?.subStatusCode ??
        status?.statusString ??
        'Falha ao criar usuário',
      response: { data: response.data },
    };
    throw syntheticError;
  }
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
    const syntheticError: AxiosLikeError = {
      message:
        status?.subStatusCode ??
        status?.statusString ??
        'Falha ao atualizar usuário',
      response: { data: response.data },
    };
    throw syntheticError;
  }
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
}

async function hikvisionPostFaceDataRecordOnce(
  connection: HikvisionReaderConnection,
  employeeNo: string,
  jpegBuffer: Buffer,
  imageFieldName: HikvisionFaceMultipartFieldName,
): Promise<void> {
  await sendHikvisionFaceMultipart(
    connection,
    'POST',
    faceDataRecordUrl(connection),
    employeeNo,
    jpegBuffer,
    imageFieldName,
  );
}

async function hikvisionPutFaceSetupOnce(
  connection: HikvisionReaderConnection,
  employeeNo: string,
  jpegBuffer: Buffer,
  imageFieldName: HikvisionFaceMultipartFieldName,
): Promise<void> {
  await sendHikvisionFaceMultipart(
    connection,
    'PUT',
    faceSetupUrl(connection),
    employeeNo,
    jpegBuffer,
    imageFieldName,
  );
}

async function hikvisionPostFaceDataRecord(
  connection: HikvisionReaderConnection,
  employeeNo: string,
  jpegBuffer: Buffer,
): Promise<void> {
  try {
    await hikvisionPostFaceDataRecordOnce(
      connection,
      employeeNo,
      jpegBuffer,
      'FaceImage',
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
    );
  }
}

async function hikvisionPutFaceSetup(
  connection: HikvisionReaderConnection,
  employeeNo: string,
  jpegBuffer: Buffer,
): Promise<void> {
  try {
    await hikvisionPutFaceSetupOnce(connection, employeeNo, jpegBuffer, 'img');
  } catch {
    await hikvisionPutFaceSetupOnce(
      connection,
      employeeNo,
      jpegBuffer,
      'FaceImage',
    );
  }
}

export async function hikvisionUpsertFace(
  connection: HikvisionReaderConnection,
  employeeNo: string,
  jpegBuffer: Buffer,
): Promise<void> {
  const normalized = await normalizeHikvisionFaceJpeg(jpegBuffer);

  if (normalized.length > HIKVISION_MAX_FACE_IMAGE_BYTES) {
    throw new Error(
      `Arquivo muito grande (${(normalized.length / 1024).toFixed(2)} KB). Limite: 200KB`,
    );
  }

  try {
    await hikvisionPostFaceDataRecord(connection, employeeNo, normalized);
  } catch (error) {
    if (isFaceAlreadyExistsError(error)) {
      await hikvisionPutFaceSetup(connection, employeeNo, normalized);
      return;
    }

    const subStatusCode = extractSubStatusCode(error);
    if (subStatusCode && FACE_LIB_NOT_FOUND_CODES.has(subStatusCode)) {
      await hikvisionCreateFaceLibrary(connection);
      await hikvisionPostFaceDataRecord(connection, employeeNo, normalized);
      return;
    }

    if (isFaceModelingError(error)) {
      await hikvisionPutFaceSetup(connection, employeeNo, normalized);
      return;
    }

    throw error;
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

const HIKVISION_LIST_PAGE_SIZE = 100;
const HIKVISION_LIST_MAX_USERS = 5000;

export async function hikvisionListDeviceUsers(
  connection: HikvisionReaderConnection,
): Promise<HikvisionDeviceUser[]> {
  const all: HikvisionDeviceUser[] = [];
  let searchResultPosition = 0;
  const searchID = `face2go-list-${Date.now()}`;

  while (all.length < HIKVISION_LIST_MAX_USERS) {
    const response = await hikvisionIsapiRequest(connection, {
      method: 'POST',
      url: `${connection.baseUrl}/ISAPI/AccessControl/UserInfo/Search?format=json`,
      headers: { 'Content-Type': 'application/json' },
      data: {
        UserInfoSearchCond: {
          searchID,
          searchResultPosition,
          maxResults: HIKVISION_LIST_PAGE_SIZE,
        },
      },
    });

    const root = asRecord(response.data);
    const search = asRecord(root?.UserInfoSearch) ?? root;
    const infoList = search?.UserInfo;
    const items = Array.isArray(infoList)
      ? infoList
      : infoList
        ? [infoList]
        : [];

    for (const item of items) {
      if (item && typeof item === 'object') {
        const mapped = mapHikvisionUserInfo(item as Record<string, unknown>);
        if (mapped) {
          all.push(mapped);
        }
      }
    }

    const statusStr = String(search?.responseStatusStrg ?? '');
    const numOfMatches = Number(search?.numOfMatches ?? items.length);
    if (!numOfMatches || statusStr === 'OK' || statusStr === 'NO MATCH') {
      break;
    }
    if (items.length < HIKVISION_LIST_PAGE_SIZE) {
      break;
    }
    searchResultPosition += numOfMatches;
  }

  return all;
}

export async function hikvisionSearchDeviceUsers(
  connection: HikvisionReaderConnection,
  search: string,
  limit: number,
  offset: number,
): Promise<HikvisionDeviceUsersListResult> {
  const term = search.trim().toUpperCase();
  const all = await hikvisionListDeviceUsers(connection);
  const filtered = term
    ? all.filter((row) => row.name.toUpperCase().includes(term))
    : all;
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const safeOffset = Math.max(offset, 0);
  const slice = filtered.slice(safeOffset, safeOffset + safeLimit);

  return {
    totalCount: filtered.length,
    found: slice.length,
    records: slice,
  };
}

export async function hikvisionSearchFace(
  connection: HikvisionReaderConnection,
  employeeNo: string,
): Promise<unknown> {
  const response = await hikvisionIsapiRequest(connection, {
    method: 'POST',
    url: `${connection.baseUrl}/ISAPI/Intelligent/FDLib/FDSearch?format=json`,
    headers: { 'Content-Type': 'application/json' },
    data: {
      searchResultPosition: 0,
      maxResults: 1,
      faceLibType: HIKVISION_FACE_LIB_TYPE,
      FDID: HIKVISION_FACE_FDID,
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
      url: `${connection.baseUrl}/ISAPI/AccessControl/UserInfo/Search?format=json`,
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

  await hikvisionUpsertUser(connection, {
    employeeNo: params.employeeNo,
    name: normalizedName,
    validDateStart: params.validDateStart,
    validDateEnd: params.validDateEnd,
  });
  await hikvisionUpsertFace(connection, params.employeeNo, params.jpegBuffer);
}
