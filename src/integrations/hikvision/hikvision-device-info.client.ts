import { Logger } from '@nestjs/common';

import type { HikvisionReaderConnection } from './hikvision-connection.types';
import { hikvisionIsapiRequest } from './hikvision-isapi-request';

export type HikvisionDeviceInfo = {
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
};

const log = new Logger('HikvisionDeviceInfo');

function cleanText(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).replaceAll('\0', '').trim();
    return text || null;
  }
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return cleanText(row['#text'] ?? row._);
  }
  return null;
}

function objectValue(row: Record<string, unknown>, key: string): unknown {
  const found = Object.keys(row).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase(),
  );
  return found ? row[found] : undefined;
}

function parseJsonObject(
  payload: Record<string, unknown>,
): HikvisionDeviceInfo {
  const nested =
    objectValue(payload, 'DeviceInfo') ?? objectValue(payload, 'deviceInfo');
  const row =
    nested && typeof nested === 'object'
      ? (nested as Record<string, unknown>)
      : payload;
  return {
    model: cleanText(objectValue(row, 'model')),
    serialNumber: cleanText(objectValue(row, 'serialNumber')),
    firmwareVersion: cleanText(objectValue(row, 'firmwareVersion')),
  };
}

function decodeXmlText(value: string): string {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .trim();
}

function xmlValue(xml: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `<(?:[\\w-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${escaped}>`,
    'i',
  ).exec(xml);
  return match?.[1] ? cleanText(decodeXmlText(match[1])) : null;
}

export function parseHikvisionDeviceInfo(
  payload: unknown,
): HikvisionDeviceInfo {
  if (Buffer.isBuffer(payload)) {
    return parseHikvisionDeviceInfo(payload.toString('utf8'));
  }
  if (typeof payload === 'string') {
    const text = payload.replaceAll('\0', '').trim();
    if (text.startsWith('{')) {
      try {
        return parseHikvisionDeviceInfo(JSON.parse(text) as unknown);
      } catch {
        // Alguns firmwares devolvem texto inválido mesmo com format=json.
      }
    }
    return {
      model: xmlValue(text, 'model'),
      serialNumber: xmlValue(text, 'serialNumber'),
      firmwareVersion: xmlValue(text, 'firmwareVersion'),
    };
  }
  if (payload && typeof payload === 'object') {
    return parseJsonObject(payload as Record<string, unknown>);
  }
  return { model: null, serialNumber: null, firmwareVersion: null };
}

function responseShape(payload: unknown): string {
  if (Buffer.isBuffer(payload)) {
    return responseShape(payload.toString('utf8'));
  }
  if (typeof payload === 'string') {
    const text = payload.replaceAll('\0', '').trim();
    if (text.startsWith('{')) {
      try {
        return responseShape(JSON.parse(text) as unknown);
      } catch {
        return `invalid-json bytes=${Buffer.byteLength(text)}`;
      }
    }
    const tags = [
      ...new Set(
        [...text.matchAll(/<(?:[\w-]+:)?([A-Za-z][\w-]*)\b/g)]
          .slice(0, 20)
          .map((match) => match[1]),
      ),
    ];
    return `text bytes=${Buffer.byteLength(text)} tags=${tags.join(',')}`;
  }
  if (payload && typeof payload === 'object') {
    const keys = Object.keys(payload).slice(0, 20);
    return `json keys=${keys.join(',')}`;
  }
  return typeof payload;
}

function hasDeviceInfo(info: HikvisionDeviceInfo): boolean {
  return Boolean(info.model || info.serialNumber || info.firmwareVersion);
}

export async function hikvisionGetDeviceInfo(
  connection: HikvisionReaderConnection,
): Promise<HikvisionDeviceInfo> {
  // Alguns firmwares no passthrough ISUP só respondem à rota XML sem query.
  const paths =
    connection.connectionMode === 'auto_register'
      ? ['/ISAPI/System/deviceInfo', '/ISAPI/System/deviceInfo?format=json']
      : ['/ISAPI/System/deviceInfo?format=json', '/ISAPI/System/deviceInfo'];
  const attempts: string[] = [];
  let lastError: Error | null = null;
  let receivedResponse = false;

  for (const path of paths) {
    try {
      const response = await hikvisionIsapiRequest(connection, {
        method: 'GET',
        url: `${connection.baseUrl}${path}`,
      });
      receivedResponse = true;
      const info = parseHikvisionDeviceInfo(response.data);
      if (hasDeviceInfo(info)) return info;
      attempts.push(
        `${path}: HTTP ${response.status}, ${responseShape(response.data)}`,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const status = (error as { response?: { status?: number } } | undefined)
        ?.response?.status;
      attempts.push(`${path}: HTTP ${status ?? 'indisponível'}`);
    }
  }

  log.warn(
    `Sem identificação do equipamento readerId=${connection.id ?? 'desconhecido'} ` +
      `mode=${connection.connectionMode ?? 'direct'} attempts=[${attempts.join('; ')}]`,
  );
  if (!receivedResponse && lastError) throw lastError;
  throw new Error(
    'O equipamento não informou modelo, firmware ou número de série.',
  );
}
