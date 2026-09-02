import { digestAuthForReader } from '../integrations/intelbras/intelbras-digest-auth';
import type { PlainReaderCredential } from '../integrations/intelbras/intelbras-device.client';

type AxiosLikeError = {
  message?: string;
  response?: { status?: number; data?: unknown };
};

function deviceUrl(reader: PlainReaderCredential): string {
  const port = reader.port ?? 80;
  return port === 80 ? `http://${reader.ip}` : `http://${reader.ip}:${port}`;
}

export function parseIntelbrasConfigText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    let key = trimmed.slice(0, eq).trim();
    if (key.startsWith('table.')) {
      key = key.slice(6);
    }
    out[key] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

export function parseIntelbrasFirmwareDate(text: string): number | null {
  const dotted = /version\.BuildDate=(\d{4}-\d{2}-\d{2})/.exec(text);
  if (dotted) {
    return Number(dotted[1].replace(/-/g, ''));
  }
  const labeled = /build:(\d{4}-\d{2}-\d{2})/i.exec(text);
  if (labeled) {
    return Number(labeled[1].replace(/-/g, ''));
  }
  const compact = /(?:version\.Version=|[.\sR])(\d{8})\b/.exec(text);
  if (compact) {
    return Number(compact[1]);
  }
  return null;
}

export async function intelbrasGetDeviceType(
  reader: PlainReaderCredential,
): Promise<string> {
  const auth = digestAuthForReader(reader);
  const url = `${deviceUrl(reader)}/cgi-bin/magicBox.cgi?action=getDeviceType`;
  const response = await auth.request({ method: 'GET', url, timeout: 12000 });
  const raw = typeof response.data === 'string' ? response.data : '';
  const match = /type=(.+)/i.exec(raw);
  return (match?.[1] ?? raw).trim();
}

export async function intelbrasGetSoftwareVersion(
  reader: PlainReaderCredential,
): Promise<{ raw: string; buildDate: number | null }> {
  const auth = digestAuthForReader(reader);
  const url = `${deviceUrl(reader)}/cgi-bin/magicBox.cgi?action=getSoftwareVersion`;
  const response = await auth.request({ method: 'GET', url });
  const raw = typeof response.data === 'string' ? response.data : '';
  return { raw, buildDate: parseIntelbrasFirmwareDate(raw) };
}

export async function intelbrasGetConfig(
  reader: PlainReaderCredential,
  name: string,
): Promise<Record<string, string>> {
  const auth = digestAuthForReader(reader);
  const url =
    `${deviceUrl(reader)}/cgi-bin/configManager.cgi` +
    `?action=getConfig&name=${encodeURIComponent(name)}`;
  const response = await auth.request({ method: 'GET', url });
  const raw = typeof response.data === 'string' ? response.data : '';
  return parseIntelbrasConfigText(raw);
}

export async function intelbrasSetConfig(
  reader: PlainReaderCredential,
  params: Record<string, string>,
): Promise<{ ok: boolean; raw: string }> {
  const auth = digestAuthForReader(reader);
  const qs = Object.entries(params)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join('&');
  const url = `${deviceUrl(reader)}/cgi-bin/configManager.cgi?action=setConfig&${qs}`;
  try {
    const response = await auth.request({ method: 'GET', url });
    const raw = typeof response.data === 'string' ? response.data : '';
    return { ok: raw.trim().toUpperCase() === 'OK', raw };
  } catch (error: unknown) {
    const err = error as AxiosLikeError;
    const data = err.response?.data;
    const raw =
      typeof data === 'string'
        ? data
        : (err.message ?? `setConfig HTTP ${err.response?.status ?? '?'}`);
    return { ok: false, raw };
  }
}
