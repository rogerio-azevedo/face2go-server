import {
  INTELBRAS_BATCH_PROCESS_ERROR_CODE,
  INTELBRAS_REQUEST_ERROR_CODES,
} from './intelbras-request-error-codes';

const REQUEST_ERROR_PT: Record<string, string> = {
  '286064900':
    'Dados de face inválidos (resolução ou formato fora do aceito pelo leitor).',
  '286064912': 'Capacidade máxima do dispositivo excedida.',
  '286064922':
    'O leitor não conseguiu extrair o rosto da foto (qualidade insuficiente ou enquadramento).',
  '286064923': 'Foto acima do limite de 100 KB.',
  '286064924': 'Memória de faces do leitor cheia.',
  '286064925': 'Usuário não existe no dispositivo.',
  '286064926': 'Foto já existe no dispositivo.',
  '286064927': 'Formato da foto inválido.',
  '268632322': 'Parâmetros inválidos no leitor.',
  '268632327': 'Tempo esgotado no leitor.',
  '268632336': 'Erro em lote no leitor.',
};

export type IntelbrasDeviceErrorInfo = {
  isKnown: boolean;
  message: string;
  code?: string;
  failCodes?: number[];
};

type DeviceErrorBody = {
  code?: number | string;
  message?: string;
  detail?: {
    FailCodes?: number[];
    FailCount?: number;
  };
};

function asDeviceErrorBody(error: unknown): DeviceErrorBody | null {
  let value: unknown = error;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value === null || typeof value !== 'object') return null;
  return value;
}

export function getErrorMessage(errorCode: number | string): string {
  const codeStr = String(errorCode);
  if (REQUEST_ERROR_PT[codeStr]) return REQUEST_ERROR_PT[codeStr];
  const entry = INTELBRAS_REQUEST_ERROR_CODES[codeStr];
  if (entry) return `${entry.code}: ${entry.description}`;
  return `Erro desconhecido: ${errorCode}`;
}

function isKnownRequestCode(errorCode: number | string): boolean {
  return String(errorCode) in INTELBRAS_REQUEST_ERROR_CODES;
}

/**
 * Interpreta o corpo de erro do dispositivo.
 * FailCodes têm prioridade sobre a mensagem genérica ("Batch Process Error").
 */
export function getErrorInfo(error: unknown): IntelbrasDeviceErrorInfo {
  const body = asDeviceErrorBody(error);
  if (!body) {
    return { isKnown: false, message: 'Erro desconhecido' };
  }

  const code = body.code !== undefined ? String(body.code) : undefined;
  const failCodes = Array.isArray(body.detail?.FailCodes)
    ? body.detail.FailCodes.filter((n) => Number.isFinite(n))
    : undefined;

  if (failCodes && failCodes.length > 0) {
    const unique = [...new Set(failCodes.map(String))];
    const messages = unique.map((c) => getErrorMessage(c));
    return {
      isKnown: unique.some((c) => isKnownRequestCode(c)),
      message: messages.join('; '),
      code,
      failCodes,
    };
  }

  if (code && isKnownRequestCode(code)) {
    return {
      isKnown: true,
      message: getErrorMessage(code),
      code,
    };
  }

  if (typeof body.message === 'string' && body.message.trim()) {
    return {
      isKnown: false,
      message: body.message.trim(),
      code,
    };
  }

  return { isKnown: false, message: 'Erro desconhecido', code };
}

/**
 * Mensagem útil para o usuário a partir do corpo HTTP do leitor.
 * Envelope de lote sem FailCodes não conta — cai no fallback genérico.
 */
export function describeIntelbrasFacialHttpError(
  responseData: unknown,
): string | null {
  const info = getErrorInfo(responseData);
  if (info.failCodes && info.failCodes.length > 0 && info.isKnown) {
    return info.message;
  }
  if (info.code === String(INTELBRAS_BATCH_PROCESS_ERROR_CODE)) {
    return null;
  }
  if (info.isKnown) return info.message;
  return null;
}
