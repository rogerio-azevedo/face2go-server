/** Parse do stream multipart `eventManager.cgi` (Intelbras / Dahua compatível). */

export interface VideoEvent {
  code: string;
  action: 'Start' | 'Stop' | 'pulse' | string;
  index: number;
  data?: Record<string, unknown>;
  raw?: Record<string, string | number>;
}

export function parseVideoEventLine(line: string): VideoEvent | null {
  if (!line.startsWith('Code=')) return null;

  try {
    const dataMarker = ';data=';
    const dataIdx = line.indexOf(dataMarker);

    const metaPart = dataIdx !== -1 ? line.substring(0, dataIdx) : line;
    const dataPart =
      dataIdx !== -1 ? line.substring(dataIdx + dataMarker.length) : null;

    const event: Partial<VideoEvent> = {};
    const raw: Record<string, string | number> = {};

    for (const segment of metaPart.split(';')) {
      const eqIdx = segment.indexOf('=');
      if (eqIdx === -1) continue;

      const key = segment.substring(0, eqIdx).toLowerCase();
      const value = segment.substring(eqIdx + 1);

      raw[key] = /^\d+$/.test(value) ? parseInt(value, 10) : value;

      if (key === 'code') event.code = value;
      else if (key === 'action') event.action = value;
      else if (key === 'index') event.index = parseInt(value, 10) || 0;
    }

    if (!event.code || !event.action) return null;

    if (dataPart) {
      try {
        event.data = JSON.parse(dataPart);
      } catch {
        event.data = undefined;
      }
    }

    return {
      code: event.code,
      action: event.action,
      index: event.index ?? 0,
      data: event.data,
      raw: Object.keys(raw).length > 0 ? raw : undefined,
    };
  } catch {
    return null;
  }
}

export function parseVideoEventPayload(
  payloadLines: string[],
): VideoEvent | null {
  if (payloadLines.length === 0) return null;

  const firstLine = payloadLines[0];
  if (!firstLine.startsWith('Code=')) return null;

  const dataMarker = ';data=';
  const dataIdx = firstLine.indexOf(dataMarker);

  let dataPart: string | null = null;
  if (dataIdx !== -1) {
    const dataStart = firstLine.substring(dataIdx + dataMarker.length);
    if (payloadLines.length > 1) {
      dataPart = [dataStart, ...payloadLines.slice(1)].join('\n');
    } else {
      dataPart = dataStart;
    }
  }

  const metaPart = dataIdx !== -1 ? firstLine.substring(0, dataIdx) : firstLine;

  try {
    const event: Partial<VideoEvent> = {};
    const raw: Record<string, string | number> = {};

    for (const segment of metaPart.split(';')) {
      const eqIdx = segment.indexOf('=');
      if (eqIdx === -1) continue;

      const key = segment.substring(0, eqIdx).toLowerCase();
      const value = segment.substring(eqIdx + 1);

      raw[key] = /^\d+$/.test(value) ? parseInt(value, 10) : value;

      if (key === 'code') event.code = value;
      else if (key === 'action') event.action = value;
      else if (key === 'index') event.index = parseInt(value, 10) || 0;
    }

    if (!event.code || !event.action) return null;

    if (dataPart) {
      try {
        event.data = JSON.parse(dataPart);
      } catch {
        event.data = undefined;
      }
    }

    return {
      code: event.code,
      action: event.action,
      index: event.index ?? 0,
      data: event.data,
      raw: Object.keys(raw).length > 0 ? raw : undefined,
    };
  } catch {
    return null;
  }
}
