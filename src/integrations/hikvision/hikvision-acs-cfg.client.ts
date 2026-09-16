import type { HikvisionReaderConnection } from './hikvision-connection.types';
import { hikvisionIsapiRequest } from './hikvision-isapi-request';
import { isHikvisionSuccess } from './hikvision-error.util';
import {
  syncLog,
  syncLogError,
} from '../../face-sync/intelbras-sync-debug.util';

/**
 * Nomes conhecidos do toggle "Autenticação de lista de bloqueio"
 * (`AcsCfg`). Firmware MinMoe varia entre camelCase e black/block.
 */
export const HIKVISION_BLOCK_LIST_AUTH_KEYS = [
  'blockListAuth',
  'blackListAuth',
  'blocklistAuth',
  'blacklistAuth',
] as const;

const acsCfgEnabledCache = new Map<string, true>();

function acsCfgUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
): string {
  return `${connection.baseUrl}/ISAPI/AccessControl/AcsCfg?format=json`;
}

function acsCfgCapabilitiesUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
): string {
  return `${connection.baseUrl}/ISAPI/AccessControl/AcsCfg/capabilities?format=json`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function unwrapAcsCfg(data: unknown): Record<string, unknown> | null {
  const root = asRecord(data);
  if (!root) {
    return null;
  }
  const wrapped = asRecord(root.AcsCfg) ?? asRecord(root.acsCfg);
  if (wrapped) {
    return wrapped;
  }
  if (collectBlockListAuthFieldNames(root).length > 0) {
    return root;
  }
  return null;
}

export function collectBlockListAuthFieldNames(node: unknown): string[] {
  const found = new Set<string>();

  const walk = (value: unknown): void => {
    const rec = asRecord(value);
    if (!rec) {
      return;
    }
    for (const [key, child] of Object.entries(rec)) {
      if (
        HIKVISION_BLOCK_LIST_AUTH_KEYS.some(
          (known) => known.toLowerCase() === key.toLowerCase(),
        )
      ) {
        found.add(key);
      }
      walk(child);
    }
  };

  walk(node);
  return [...found];
}

export function isHikvisionEnabledFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function setNestedField(
  target: Record<string, unknown>,
  fieldName: string,
  enabled: boolean,
): boolean {
  if (Object.prototype.hasOwnProperty.call(target, fieldName)) {
    target[fieldName] = enabled;
    return true;
  }

  for (const child of Object.values(target)) {
    const rec = asRecord(child);
    if (rec && setNestedField(rec, fieldName, enabled)) {
      return true;
    }
  }
  return false;
}

export function resetHikvisionAcsCfgCache(): void {
  acsCfgEnabledCache.clear();
}

/**
 * Garante o toggle de autenticação de lista de bloqueio no leitor.
 * Falha não derruba o sync — alguns firmwares já negam só com `userType=blackList`.
 */
export async function hikvisionEnsureBlockListAuth(
  connection: HikvisionReaderConnection,
): Promise<void> {
  const cacheKey = connection.baseUrl;
  if (acsCfgEnabledCache.has(cacheKey)) {
    return;
  }

  try {
    let capabilities: unknown;
    try {
      const capResponse = await hikvisionIsapiRequest(connection, {
        method: 'GET',
        url: acsCfgCapabilitiesUrl(connection),
      });
      capabilities = capResponse.data;
    } catch (err: unknown) {
      syncLog('hikvision:acsCfgCapabilitiesSkip', {
        baseUrl: connection.baseUrl,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    const cfgResponse = await hikvisionIsapiRequest(connection, {
      method: 'GET',
      url: acsCfgUrl(connection),
    });
    const cfgRoot = asRecord(cfgResponse.data);
    const acsCfg = unwrapAcsCfg(cfgResponse.data);
    if (!cfgRoot || !acsCfg) {
      syncLog('hikvision:acsCfgEmpty', { baseUrl: connection.baseUrl });
      return;
    }

    const discovered = [
      ...collectBlockListAuthFieldNames(capabilities),
      ...collectBlockListAuthFieldNames(acsCfg),
    ];
    const fieldName =
      discovered.find((name) =>
        Object.prototype.hasOwnProperty.call(acsCfg, name),
      ) ??
      discovered[0] ??
      HIKVISION_BLOCK_LIST_AUTH_KEYS.find((name) =>
        Object.prototype.hasOwnProperty.call(acsCfg, name),
      );

    if (!fieldName) {
      syncLog('hikvision:acsCfgNoBlockListField', {
        baseUrl: connection.baseUrl,
      });
      return;
    }

    const current =
      acsCfg[fieldName] ??
      collectBlockListAuthFieldNames(acsCfg)
        .map((name) => acsCfg[name])
        .find((value) => value !== undefined);

    if (isHikvisionEnabledFlag(current)) {
      acsCfgEnabledCache.set(cacheKey, true);
      return;
    }

    const nextCfg = structuredClone(acsCfg);
    if (!setNestedField(nextCfg, fieldName, true)) {
      nextCfg[fieldName] = true;
    }

    const payload =
      cfgRoot.AcsCfg || cfgRoot.acsCfg ? { AcsCfg: nextCfg } : nextCfg;
    const putResponse = await hikvisionIsapiRequest(connection, {
      method: 'PUT',
      url: acsCfgUrl(connection),
      headers: { 'Content-Type': 'application/json' },
      data: payload,
    });

    if (!isHikvisionSuccess(putResponse.data)) {
      throw new Error('PUT AcsCfg não retornou sucesso');
    }

    acsCfgEnabledCache.set(cacheKey, true);
    syncLog('hikvision:acsCfgBlockListAuthOk', {
      baseUrl: connection.baseUrl,
      fieldName,
    });
  } catch (err: unknown) {
    syncLogError('hikvision:ensureBlockListAuth', err, {
      baseUrl: connection.baseUrl,
    });
  }
}
