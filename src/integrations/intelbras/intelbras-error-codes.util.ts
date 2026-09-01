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
  '286064926':
    'Foto já cadastrada neste leitor (arquivo duplicado). Use uma foto diferente ou desative o filtro de face repetida no dispositivo.',
  '286064927': 'Formato da foto inválido.',
  '268632322': 'Parâmetros inválidos no leitor.',
  '268632327': 'Tempo esgotado no leitor.',
  '268632336': 'Erro em lote no leitor.',
  '288686080': 'Erro no cadastro de face no leitor.',
  '288686081': 'Foto acima do limite de tamanho aceito pelo leitor.',
  '288686082':
    'Usuário não existe no leitor; cadastre o usuário antes da foto.',
  '288686083': 'O leitor não conseguiu extrair as características da foto.',
  '288686084':
    'Foto já cadastrada neste leitor (arquivo duplicado). Use uma foto diferente ou desative o filtro de face repetida no dispositivo.',
  '288686085': 'Quantidade máxima de fotos no leitor excedida.',
  '288686086': 'Formato da foto inválido.',
  '288686087': 'Nenhum rosto detectado na foto.',
  '288686088': 'Mais de um rosto detectado na foto.',
  '288686089': 'O leitor não conseguiu decodificar a foto.',
  '288686090': 'Qualidade da foto insuficiente para o leitor.',
  '288686091':
    'O leitor considerou a foto pouco confiável (enquadramento ou nitidez).',
  '288686092':
    'Este rosto já está cadastrado no leitor (foto muito parecida, comum em gêmeos). Desative o filtro de face repetida no dispositivo ou use fotos mais distintas.',
  '288686093': 'Ângulo do rosto fora do aceito pelo leitor.',
  '288686094':
    'O rosto deve ocupar entre 1/3 e 2/3 da foto (proporção fora do intervalo).',
  '288686095': 'Rosto superexposto na foto.',
  '288686096': 'Rosto subexposto na foto.',
  '288686097': 'Iluminação irregular no rosto (metade clara e metade escura).',
  '288686098': 'Baixa confiança na detecção do rosto.',
  '288686099': 'Rosto desalinhado na foto.',
  '288686100': 'Rosto obstruído (mão, cabelo, máscara ou similar).',
  '288686101': 'Distância entre os olhos abaixo do mínimo do leitor.',
  '288686102': 'Falha ao baixar a foto da face.',
  '288686103': 'Rosto detectado, mas o leitor não extraiu as características.',
  '288686104':
    'Foto filtrada pelo leitor (máscara, óculos, chapéu ou atributo similar).',
  '288686105': 'Imagem do rosto incompleta.',
  '288686106': 'Tamanho das características faciais inválido.',
  '288686107': 'Características faciais inválidas.',
  '288686108': 'Falha ao adicionar o usuário no leitor.',
  '288686109': 'Falha ao atualizar o usuário no leitor.',
  '288686110': 'Falha ao atualizar informações da sala no leitor.',
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

/** Cadastro recusado porque a foto/biometria já existe (gêmeos, filtro EnableRepFaceFilt). */
export const DUPLICATE_FACE_ENROLLMENT_CODES = new Set([
  '286064926',
  '288686084',
  '288686092',
]);

function collectDeviceErrorBodies(error: unknown): unknown[] {
  const bodies: unknown[] = [];
  let node: unknown = error;
  for (let i = 0; i < 6 && node; i++) {
    bodies.push(node);
    if (node && typeof node === 'object' && 'response' in node) {
      const data = (node as { response?: { data?: unknown } }).response?.data;
      if (data !== undefined) bodies.push(data);
    }
    node =
      node instanceof Error && 'cause' in node
        ? (node as Error & { cause?: unknown }).cause
        : undefined;
  }
  return bodies;
}

export function isDuplicateFaceEnrollmentError(error: unknown): boolean {
  for (const body of collectDeviceErrorBodies(error)) {
    const info = getErrorInfo(body);
    if (
      info.failCodes?.some((c) =>
        DUPLICATE_FACE_ENROLLMENT_CODES.has(String(c)),
      )
    ) {
      return true;
    }
    if (info.code && DUPLICATE_FACE_ENROLLMENT_CODES.has(info.code)) {
      return true;
    }
  }
  return false;
}
