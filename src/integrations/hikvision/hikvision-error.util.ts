export const USER_ALREADY_EXISTS_CODES = new Set([
  'deviceUserAlreadyExist',
  'employeeNoAlreadyExist',
]);

export const USER_NOT_FOUND_CODES = new Set([
  'employeeNoNotExist',
  'deviceUserNotExist',
  'userNotExist',
  'employeeNoNotExistInDevice',
  'EmployeeNoNotExist',
]);

export const FACE_ALREADY_EXISTS_CODES = new Set([
  'deviceUserAlreadyExistFace',
]);

export const FACE_LIB_NOT_FOUND_CODES = new Set([
  'faceLibNotExist',
  'FDLibNotExist',
  'faceDatabaseNotExist',
]);

export const FACE_MODELING_ERROR_CODES = new Set([
  'SubpicAnalysisModelingError',
  'PicFeaturePoints',
  'faceModelingError',
  'faceQualityLow',
]);

type HikvisionResponseStatus = {
  statusCode?: number | string;
  statusString?: string;
  subStatusCode?: string;
  errorCode?: number | string;
  errorMsg?: string;
};

type AxiosLikeError = {
  message?: string;
  response?: {
    status?: number;
    statusText?: string;
    data?: unknown;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return null;
}

function extractXmlTagValue(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const match = xml.match(re);
  const value = match?.[1]?.trim();
  return value || undefined;
}

function parseXmlResponseStatus(xml: string): HikvisionResponseStatus | null {
  const trimmed = xml.trim();
  if (!trimmed.startsWith('<')) {
    return null;
  }

  const statusCode = extractXmlTagValue(trimmed, 'statusCode');
  const statusString = extractXmlTagValue(trimmed, 'statusString');
  const subStatusCode = extractXmlTagValue(trimmed, 'subStatusCode');
  const errorCode = extractXmlTagValue(trimmed, 'errorCode');
  const errorMsg = extractXmlTagValue(trimmed, 'errorMsg');

  if (
    !statusCode &&
    !statusString &&
    !subStatusCode &&
    !errorCode &&
    !errorMsg
  ) {
    return null;
  }

  return {
    statusCode,
    statusString,
    subStatusCode,
    errorCode,
    errorMsg,
  };
}

export function extractResponseStatus(
  data: unknown,
): HikvisionResponseStatus | null {
  if (typeof data === 'string') {
    return parseXmlResponseStatus(data);
  }

  const root = asRecord(data);
  if (!root) {
    return null;
  }
  const nested =
    asRecord(root.ResponseStatus) ?? asRecord(root.responseStatus) ?? root;
  return nested;
}

export function isHikvisionSuccess(data: unknown): boolean {
  if (data == null || data === '') {
    return true;
  }

  const status = extractResponseStatus(data);
  if (!status) {
    return true;
  }

  const codeRaw = status.statusCode;
  if (codeRaw != null && String(codeRaw).trim() !== '') {
    const code = String(codeRaw);
    return code === '1' || code === 'OK';
  }

  const errorCode = status.errorCode;
  if (errorCode != null && String(errorCode).trim() !== '') {
    const ec = String(errorCode);
    if (ec !== '0') {
      return false;
    }
  }

  if (status.subStatusCode && status.subStatusCode.trim() !== '') {
    const sub = status.subStatusCode;
    if (
      USER_NOT_FOUND_CODES.has(sub) ||
      FACE_MODELING_ERROR_CODES.has(sub) ||
      FACE_LIB_NOT_FOUND_CODES.has(sub)
    ) {
      return false;
    }
  }

  return true;
}

export function extractSubStatusCode(error: unknown): string | undefined {
  const err = error as AxiosLikeError;
  const fromBody = extractResponseStatus(err.response?.data);
  return fromBody?.subStatusCode ?? fromBody?.errorMsg;
}

export function hikvisionFaceErrorMessage(error: unknown): string {
  const err = error as AxiosLikeError;
  const status = extractResponseStatus(err.response?.data);
  if (
    status?.subStatusCode &&
    FACE_MODELING_ERROR_CODES.has(status.subStatusCode)
  ) {
    return (
      'O leitor não conseguiu analisar o rosto na foto. ' +
      'Tire uma foto frontal, bem iluminada, com o rosto centralizado e ocupe boa parte da imagem.'
    );
  }
  if (status?.subStatusCode) {
    const parts = [status.subStatusCode];
    if (status.errorMsg && status.errorMsg !== status.subStatusCode) {
      parts.push(status.errorMsg);
    }
    if (status.statusString) {
      parts.push(status.statusString);
    }
    return parts.join(' — ');
  }
  if (status?.statusString) {
    return status.statusString;
  }
  return err.message ?? 'Erro desconhecido ao sincronizar face Hikvision';
}

export function isFaceAlreadyExistsError(error: unknown): boolean {
  const subStatusCode = extractSubStatusCode(error);
  return subStatusCode != null && FACE_ALREADY_EXISTS_CODES.has(subStatusCode);
}

export function isFaceModelingError(error: unknown): boolean {
  const subStatusCode = extractSubStatusCode(error);
  return subStatusCode != null && FACE_MODELING_ERROR_CODES.has(subStatusCode);
}

export function isUserNotFoundError(error: unknown): boolean {
  const subStatusCode = extractSubStatusCode(error);
  return subStatusCode != null && USER_NOT_FOUND_CODES.has(subStatusCode);
}

/** Mensagem por leitor para `deviceSyncError` (FaceSyncService). */
export function formatHikvisionFaceSyncError(
  readerName: string,
  err: unknown,
): string {
  return `${readerName}: ${hikvisionFaceErrorMessage(err)}`;
}
