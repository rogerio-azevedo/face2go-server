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

export const FACE_ALREADY_EXISTS_CODES = new Set(['deviceUserAlreadyExistFace']);

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

export function extractResponseStatus(
  data: unknown,
): HikvisionResponseStatus | null {
  const root = asRecord(data);
  if (!root) {
    return null;
  }
  const nested =
    asRecord(root.ResponseStatus) ??
    asRecord(root.responseStatus) ??
    root;
  return nested as HikvisionResponseStatus;
}

export function isHikvisionSuccess(data: unknown): boolean {
  const status = extractResponseStatus(data);
  if (!status?.statusCode) {
    return true;
  }
  const code = String(status.statusCode);
  return code === '1' || code === 'OK';
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
