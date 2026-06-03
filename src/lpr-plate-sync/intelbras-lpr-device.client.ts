import AxiosDigestAuth from '@mhoc/axios-digest-auth';

import type { CameraLprPlateSyncRow } from '../database/queries/cameras.queries';
import {
  DEFAULT_INTELBRAS_VALID_DATE_END,
  DEFAULT_INTELBRAS_VALID_DATE_START,
} from '../face-sync/intelbras-valid-date.util';
import { mapReaderError } from '../face-sync/intelbras-device.client';

const TRAFFIC_LIST_NAME = 'TrafficRedList';

const CAMERA_HTTP_TIMEOUT_MS = 10_000;

/** Mapeamento de erros HTTP/rede específico para LPR — evita mensagens de cadastro facial no HTTP 400. */
export function mapCameraLprError(err: unknown): string {
  return mapReaderError(err, 'lpr');
}

export type PlainCameraCredential = {
  id: string;
  name: string;
  ip: string;
  port: number;
  username: string;
  plainPassword: string;
};

export function toPlainCameraCredential(
  row: CameraLprPlateSyncRow,
  decryptedPassword: string,
): PlainCameraCredential {
  return {
    id: row.id,
    name: row.name,
    ip: row.ip.trim(),
    port: row.port ?? 80,
    username: row.username.trim(),
    plainPassword: decryptedPassword,
  };
}

export function formatCameraLprPlateError(
  cameraName: string,
  err: unknown,
): string {
  return `${cameraName}: ${mapCameraLprError(err)}`;
}

function deviceUrl(camera: PlainCameraCredential): string {
  const port = camera.port ?? 80;
  return port === 80 ? `http://${camera.ip}` : `http://${camera.ip}:${port}`;
}

type ApiDigestResponse = { status?: number; data?: unknown };

async function digestRequest(
  auth: AxiosDigestAuth,
  init: {
    method: 'GET' | 'POST';
    url: string;
    data?: Record<string, unknown>;
    headers?: Record<string, string>;
  },
): Promise<ApiDigestResponse> {
  return auth.request({
    ...init,
    timeout: CAMERA_HTTP_TIMEOUT_MS,
  } as Parameters<AxiosDigestAuth['request']>[0]);
}

function normalizePlate(plate: string): string {
  return plate
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Dahua Intelligent Traffic API: BeginTime/CancelTime como YYYY-MM-DD. */
function lprTrafficDateOnly(isoDateTime: string): string {
  const t = isoDateTime.trim();
  if (t.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  return t;
}

function httpStatusFromDigestError(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const r = err as { response?: { status?: unknown }; status?: unknown };
  const st = r.response?.status ?? r.status;
  if (typeof st === 'number' && Number.isFinite(st)) return st;
  if (typeof st === 'string') {
    const n = parseInt(st, 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function digestResponseSnippet(err: unknown): string {
  if (typeof err !== 'object' || err === null) return '';
  const data = (err as { response?: { data?: unknown } }).response?.data;
  if (typeof data === 'string' && data.trim()) {
    return data.trim().slice(0, 200);
  }
  if (data != null) {
    try {
      return JSON.stringify(data).slice(0, 200);
    } catch {
      return '';
    }
  }
  return '';
}

type TrafficInsertUrlOpts = {
  plate: string;
  master: string;
  vehicleColor: string;
  beginTime: string;
  cancelTime: string;
  plateColor: string;
  plateType: string | null;
  openGate: boolean;
};

function buildTrafficInsertUrl(
  base: string,
  opts: TrafficInsertUrlOpts,
): string {
  const pl = encodeURIComponent(opts.plate);
  const master = encodeURIComponent(opts.master);
  const col = encodeURIComponent(opts.vehicleColor);
  const qsStart = encodeURIComponent(opts.beginTime);
  const qsEnd = encodeURIComponent(opts.cancelTime);
  const pColor = encodeURIComponent(opts.plateColor);

  let url =
    `${base}/cgi-bin/recordUpdater.cgi?action=insert&name=${TRAFFIC_LIST_NAME}` +
    `&PlateNumber=${pl}&MasterOfCar=${master}&PlateColor=${pColor}&VehicleColor=${col}` +
    `&BeginTime=${qsStart}&CancelTime=${qsEnd}`;

  if (opts.plateType) {
    url += `&PlateType=${encodeURIComponent(opts.plateType)}`;
  }
  if (opts.openGate) {
    url += '&AuthorityList[0].OpenGate=true';
  }
  return url;
}

function buildTrafficUpdateUrl(
  base: string,
  recNo: number,
  opts: TrafficInsertUrlOpts,
): string {
  const pl = encodeURIComponent(opts.plate);
  const master = encodeURIComponent(opts.master);
  const col = encodeURIComponent(opts.vehicleColor);
  const qsStart = encodeURIComponent(opts.beginTime);
  const qsEnd = encodeURIComponent(opts.cancelTime);
  const pColor = encodeURIComponent(opts.plateColor);

  let url =
    `${base}/cgi-bin/recordUpdater.cgi?action=update&name=${TRAFFIC_LIST_NAME}` +
    `&recno=${encodeURIComponent(String(recNo))}` +
    `&PlateNumber=${pl}&MasterOfCar=${master}&PlateColor=${pColor}&VehicleColor=${col}` +
    `&BeginTime=${qsStart}&CancelTime=${qsEnd}`;

  if (opts.plateType) {
    url += `&PlateType=${encodeURIComponent(opts.plateType)}`;
  }
  if (opts.openGate) {
    url += '&AuthorityList[0].OpenGate=true';
  }
  return url;
}

async function digestRequestOrThrow(
  auth: AxiosDigestAuth,
  url: string,
): Promise<void> {
  const r = await digestRequest(auth, { method: 'GET', url });
  const st = r.status;
  if (st != null && st >= 400) {
    throw Object.assign(new Error(`HTTP ${st}`), {
      response: { status: st, data: r.data },
    });
  }
}

type TrafficRecordAccumulator = Partial<{
  PlateNumber: string;
  RecNo: string;
  MasterOfCar: string;
  Owner: string;
  OwnerName: string;
}> & { index: number };

function parseTrafficRecords(text: string): TrafficRecordAccumulator[] {
  const byIdx = new Map<number, TrafficRecordAccumulator>();

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const m = /^records\[(\d+)\]\.(.+?)=(.*)$/.exec(trimmed);
    if (!m) continue;

    const index = parseInt(m[1], 10);
    const key = m[2].trim();
    const value = m[3].trim();

    if (!Number.isFinite(index)) continue;

    let rec = byIdx.get(index);
    if (!rec) {
      rec = { index };
      byIdx.set(index, rec);
    }

    if (key === 'PlateNumber') rec.PlateNumber = value;
    else if (key === 'RecNo') rec.RecNo = value;
    else if (key === 'PlateNo') rec.PlateNumber ||= value;
    else if (key === 'MasterOfCar') rec.MasterOfCar = value;
    else if (key === 'Owner') rec.Owner = value;
    else if (key === 'OwnerName') rec.OwnerName = value;
  }

  return [...byIdx.values()].sort((a, b) => a.index - b.index);
}

function findRecordIndexForPlate(
  records: TrafficRecordAccumulator[],
  plate: string,
) {
  const target = normalizePlate(plate);
  for (let i = 0; i < records.length; i++) {
    const rn = records[i]?.PlateNumber;
    if (!rn) continue;
    if (normalizePlate(rn) === target) return i;
  }
  return -1;
}

export type TrafficPlateLookup = {
  plateMatched: boolean;
  recNo: number | null;
};

function lookupFromFinderText(text: string, plate: string): TrafficPlateLookup {
  const recs = parseTrafficRecords(text);
  const idx = findRecordIndexForPlate(recs, plate);
  if (idx < 0) return { plateMatched: false, recNo: null };

  const raw = recs[idx]?.RecNo;
  const n = raw != null && raw !== '' ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n > 0) return { plateMatched: true, recNo: n };
  return { plateMatched: true, recNo: null };
}

/** Localiza RecNa na TrafficRedList (Intelbras Dahua-compat). */
export async function intelbrasTrafficPlateLookup(
  camera: PlainCameraCredential,
  plate: string,
): Promise<TrafficPlateLookup> {
  const normalized = normalizePlate(plate);
  if (!normalized) return { plateMatched: false, recNo: null };

  const auth = new AxiosDigestAuth({
    username: camera.username,
    password: camera.plainPassword,
  });
  const base = deviceUrl(camera);
  const enc = encodeURIComponent(normalized);

  const candidates: string[] = [
    `${base}/cgi-bin/recordFinder.cgi?action=find&name=${TRAFFIC_LIST_NAME}&PlateNumber=${enc}`,
    `${base}/cgi-bin/recordFinder.cgi?action=find&name=${TRAFFIC_LIST_NAME}&Condition.PlateNumber=${enc}`,
    `${base}/cgi-bin/recordFinder.cgi?action=doSeekFind&name=${TRAFFIC_LIST_NAME}&PlateNumber=${enc}&count=500&offset=0`,
    `${base}/cgi-bin/recordFinder.cgi?action=doSeekFind&name=${TRAFFIC_LIST_NAME}&Condition.PlateNumber=${enc}&count=500&offset=0`,
  ];

  for (const url of candidates) {
    try {
      const r = await digestRequest(auth, { method: 'GET', url });
      if (typeof r.data !== 'string') continue;
      const hit = lookupFromFinderText(r.data, normalized);
      if (hit.plateMatched) return hit;
    } catch {
      /* tenta próximo */
    }
  }

  try {
    const bulkUrl = `${base}/cgi-bin/recordFinder.cgi?action=doSeekFind&name=${TRAFFIC_LIST_NAME}&count=500&offset=0`;
    const r = await digestRequest(auth, { method: 'GET', url: bulkUrl });
    if (typeof r.data !== 'string') {
      return { plateMatched: false, recNo: null };
    }
    return lookupFromFinderText(r.data, normalized);
  } catch {
    return { plateMatched: false, recNo: null };
  }
}

/** Se a placa já está na lista, não insere novamente (idempotente). */
export async function intelbrasInsertPlate(
  camera: PlainCameraCredential,
  plate: string,
  ownerDisplayName: string,
  vehicleColor: string | null | undefined,
): Promise<void> {
  const normalized = normalizePlate(plate);
  if (!normalized) {
    throw new Error('Placa inválida para sincronizar com a câmera.');
  }

  const look = await intelbrasTrafficPlateLookup(camera, normalized);
  if (look.plateMatched) return;

  const auth = new AxiosDigestAuth({
    username: camera.username,
    password: camera.plainPassword,
  });
  const base = deviceUrl(camera);
  const master = (ownerDisplayName.trim() || 'CONDUTOR').slice(0, 15);
  const col =
    (vehicleColor ?? 'Desconhecida').trim().slice(0, 31) || 'Desconhecida';

  const dateOnlyStart = lprTrafficDateOnly(DEFAULT_INTELBRAS_VALID_DATE_START);
  const dateOnlyEnd = lprTrafficDateOnly(DEFAULT_INTELBRAS_VALID_DATE_END);
  const legacyStart = DEFAULT_INTELBRAS_VALID_DATE_START;
  const legacyEnd = DEFAULT_INTELBRAS_VALID_DATE_END;

  const insertCandidates: TrafficInsertUrlOpts[] = [
    {
      plate: normalized,
      master,
      vehicleColor: col,
      beginTime: dateOnlyStart,
      cancelTime: dateOnlyEnd,
      plateColor: 'Yellow',
      plateType: null,
      openGate: true,
    },
    {
      plate: normalized,
      master,
      vehicleColor: col,
      beginTime: dateOnlyStart,
      cancelTime: dateOnlyEnd,
      plateColor: 'Gray',
      plateType: 'Normal',
      openGate: true,
    },
    {
      plate: normalized,
      master,
      vehicleColor: col,
      beginTime: legacyStart,
      cancelTime: legacyEnd,
      plateColor: 'Gray',
      plateType: 'Normal',
      openGate: false,
    },
  ];

  let lastErr: unknown;
  for (const opts of insertCandidates) {
    const url = buildTrafficInsertUrl(base, opts);
    try {
      await digestRequestOrThrow(auth, url);
      return;
    } catch (e) {
      lastErr = e;
      const st = httpStatusFromDigestError(e);
      if (st === 400) {
        const retry = await intelbrasTrafficPlateLookup(camera, normalized);
        if (retry.plateMatched) return;
        if (retry.recNo != null && retry.recNo > 0) {
          try {
            const updateUrl = buildTrafficUpdateUrl(base, retry.recNo, opts);
            await digestRequestOrThrow(auth, updateUrl);
            return;
          } catch (updateErr) {
            lastErr = updateErr;
          }
        }
      }
    }
  }

  const snippet = digestResponseSnippet(lastErr);
  const baseMsg =
    lastErr instanceof Error
      ? lastErr.message
      : typeof lastErr === 'string'
        ? lastErr
        : 'erro';
  throw new Error(snippet ? `${baseMsg}: ${snippet}` : baseMsg);
}

/** Remove registro da TrafficRedList pelo RecNo (idempotente se já removido). */
export async function intelbrasRemovePlateByRecNo(
  camera: PlainCameraCredential,
  recNo: number,
): Promise<void> {
  if (!Number.isFinite(recNo) || recNo < 1) {
    throw new Error('RecNo inválido para remover placa da câmera.');
  }
  const auth = new AxiosDigestAuth({
    username: camera.username,
    password: camera.plainPassword,
  });
  const base = deviceUrl(camera);
  const url = `${base}/cgi-bin/recordUpdater.cgi?action=remove&name=${TRAFFIC_LIST_NAME}&recno=${encodeURIComponent(String(recNo))}`;
  await digestRequestOrThrow(auth, url);
}

/** Remove por placa (lookup → recno). Sem erro se já ausente na lista. */
export async function intelbrasRemovePlate(
  camera: PlainCameraCredential,
  plate: string,
): Promise<void> {
  const normalized = normalizePlate(plate);
  if (!normalized) {
    throw new Error('Placa inválida para remover da câmera.');
  }
  const look = await intelbrasTrafficPlateLookup(camera, normalized);
  if (!look.plateMatched || look.recNo == null || look.recNo < 1) return;
  await intelbrasRemovePlateByRecNo(camera, look.recNo);
}

/** Remove da câmera usando RecNo (preferido) ou número da placa. */
export async function intelbrasRemovePlateFromCamera(
  camera: PlainCameraCredential,
  opts: { recNo?: number | null; plate?: string },
): Promise<void> {
  const rec = opts.recNo;
  if (rec != null && Number.isFinite(rec) && rec > 0) {
    await intelbrasRemovePlateByRecNo(camera, rec);
    return;
  }
  const pl = opts.plate?.trim();
  if (pl) {
    await intelbrasRemovePlate(camera, pl);
    return;
  }
  throw new Error('Informe RecNo ou placa para remover da câmera.');
}

/** Diagnóstico (primeiros registros). */
export async function intelbrasListTrafficPlates(
  camera: PlainCameraCredential,
  count: number,
  offset: number,
): Promise<{ found: number; text: string }> {
  const auth = new AxiosDigestAuth({
    username: camera.username,
    password: camera.plainPassword,
  });
  const base = deviceUrl(camera);
  const safeCount = Math.min(Math.max(count, 1), 500);
  const safeOffset = Math.max(offset, 0);
  const url = `${base}/cgi-bin/recordFinder.cgi?action=doSeekFind&name=${TRAFFIC_LIST_NAME}&count=${safeCount}&offset=${safeOffset}`;

  const r = await digestRequest(auth, { method: 'GET', url });

  const text =
    typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? '');

  let found = 0;
  for (const line of text.split('\n')) {
    const m = /^found=(\d+)$/.exec(line.trim());
    if (m) {
      found = parseInt(m[1], 10) || 0;
      break;
    }
  }

  return { found, text };
}

export type DevicePlate = {
  plateNumber: string;
  recNo: number | null;
  /** Proprietário / condutor — CGI costuma expor como `MasterOfCar`. */
  owner: string;
};

export type DevicePlatesListResult = {
  totalCount: number;
  found: number;
  records: DevicePlate[];
};

function parseFinderCounts(text: string): {
  totalCount: number;
  found: number;
} {
  let totalCount = 0;
  let found = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    const mTotal = /^totalCount=(\d+)$/.exec(t);
    if (mTotal) {
      totalCount = parseInt(mTotal[1], 10) || 0;
      continue;
    }
    const mFound = /^found=(\d+)$/.exec(t);
    if (mFound) {
      found = parseInt(mFound[1], 10) || 0;
      continue;
    }
  }
  return { totalCount, found };
}

function parsePlateListFromText(text: string): DevicePlatesListResult {
  const { totalCount, found } = parseFinderCounts(text);
  const raw = parseTrafficRecords(text);
  const records: DevicePlate[] = raw.map((rec) => {
    const rn =
      rec.RecNo != null && rec.RecNo !== '' ? parseInt(rec.RecNo, 10) : NaN;
    const owner = (rec.MasterOfCar ?? rec.Owner ?? rec.OwnerName ?? '').trim();
    return {
      plateNumber: (rec.PlateNumber ?? '').trim(),
      recNo: Number.isFinite(rn) && rn > 0 ? rn : null,
      owner,
    };
  });
  return { totalCount, found, records };
}

function parseQuerySizeFromText(text: string): number {
  let size = 0;
  let count = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    const mSize = /^Size=(\d+)$/.exec(t);
    if (mSize) {
      size = parseInt(mSize[1], 10) || 0;
      continue;
    }
    const mCount = /^count=(\d+)$/.exec(t);
    if (mCount) count = parseInt(mCount[1], 10) || 0;
  }
  return Math.max(size, count);
}

function resolveTotalCount(
  page: DevicePlatesListResult,
  offset: number,
  sizeFromQuery: number | null,
  pageSize: number,
): number {
  if (sizeFromQuery != null && sizeFromQuery > 0) return sizeFromQuery;
  if (page.totalCount > 0) return page.totalCount;
  if (page.found > page.records.length) return page.found;
  const loaded = offset + page.records.length;
  if (page.records.length < pageSize) return loaded;
  return Math.max(page.found, loaded);
}

const QUERY_SIZE_LIST_NAMES = [
  TRAFFIC_LIST_NAME,
  'TrafficAllowList',
  'AllowList',
] as const;

const DEVICE_PLATES_BATCH_SIZE = 500;

/**
 * Total de placas na TrafficRedList via getQuerySize (quando o firmware suporta).
 */
export async function intelbrasGetDevicePlateCount(
  camera: PlainCameraCredential,
): Promise<number | null> {
  const auth = new AxiosDigestAuth({
    username: camera.username,
    password: camera.plainPassword,
  });
  const base = deviceUrl(camera);

  for (const listName of QUERY_SIZE_LIST_NAMES) {
    const url = `${base}/cgi-bin/recordFinder.cgi?action=getQuerySize&name=${listName}`;
    try {
      const r = await digestRequest(auth, { method: 'GET', url });
      if (typeof r.data !== 'string') continue;
      const size = parseQuerySizeFromText(r.data);
      if (size > 0) return size;
    } catch {
      /* tenta próximo nome */
    }
  }
  return null;
}

/**
 * Varre a lista em lotes (doSeekFind) quando getQuerySize não está disponível.
 */
async function discoverDevicePlateCount(
  camera: PlainCameraCredential,
): Promise<number> {
  let offset = 0;

  while (true) {
    const page = await fetchDevicePlatesPage(
      camera,
      DEVICE_PLATES_BATCH_SIZE,
      offset,
      true,
    );
    if (page.records.length < DEVICE_PLATES_BATCH_SIZE) {
      return offset + page.records.length;
    }
    if (page.totalCount > 0) return page.totalCount;
    offset += DEVICE_PLATES_BATCH_SIZE;
  }
}

async function fetchDevicePlatesPage(
  camera: PlainCameraCredential,
  count: number,
  offset: number,
  doSeekFindOnly = false,
): Promise<DevicePlatesListResult> {
  const auth = new AxiosDigestAuth({
    username: camera.username,
    password: camera.plainPassword,
  });
  const base = deviceUrl(camera);
  const safeCount = Math.min(Math.max(count, 1), 500);
  const safeOffset = Math.max(offset, 0);

  const doSeekUrl = `${base}/cgi-bin/recordFinder.cgi?action=doSeekFind&name=${TRAFFIC_LIST_NAME}&count=${safeCount}&offset=${safeOffset}`;
  const findUrl = `${base}/cgi-bin/recordFinder.cgi?action=find&name=${TRAFFIC_LIST_NAME}&count=${safeCount}&offset=${safeOffset}`;

  // doSeekFind respeita offset; `find` em vários firmwares ignora e quebra paginação.
  const candidates: string[] =
    doSeekFindOnly || safeOffset > 0 ? [doSeekUrl] : [doSeekUrl, findUrl];

  let lastErr: unknown;
  for (const url of candidates) {
    try {
      const r = await digestRequest(auth, { method: 'GET', url });
      if (typeof r.data !== 'string') continue;
      return parsePlateListFromText(r.data);
    } catch (e) {
      lastErr = e;
    }
  }

  if (lastErr instanceof Error) throw lastErr;
  if (typeof lastErr === 'string' && lastErr.trim()) {
    throw new Error(lastErr);
  }
  throw new Error('Resposta inválida da câmera ao listar placas.');
}

async function fetchAllDevicePlates(
  camera: PlainCameraCredential,
): Promise<DevicePlate[]> {
  const all: DevicePlate[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchDevicePlatesPage(
      camera,
      DEVICE_PLATES_BATCH_SIZE,
      offset,
      true,
    );
    all.push(...page.records);
    if (page.records.length < DEVICE_PLATES_BATCH_SIZE) break;
    offset += DEVICE_PLATES_BATCH_SIZE;
    const cap =
      page.totalCount > 0 ? page.totalCount : offset + page.records.length;
    if (offset >= cap) break;
  }

  return all;
}

/**
 * Lista placas da TrafficRedList (allowlist), paginada.
 * Alguns firmwares só aceitam `action=find` (doc Intelbras LPR); outros `doSeekFind`.
 * Não reutiliza o CGI do leitor facial (`AccessControlCard`) — só o mesmo padrão Dahua (Digest + recordFinder).
 */
export async function intelbrasGetDevicePlates(
  camera: PlainCameraCredential,
  count: number,
  offset: number,
): Promise<DevicePlatesListResult> {
  const safeCount = Math.min(Math.max(count, 1), 500);
  const safeOffset = Math.max(offset, 0);

  const [page, sizeFromQuery] = await Promise.all([
    fetchDevicePlatesPage(camera, safeCount, safeOffset),
    intelbrasGetDevicePlateCount(camera),
  ]);

  let totalCount = resolveTotalCount(
    page,
    safeOffset,
    sizeFromQuery,
    safeCount,
  );

  const needsDiscover =
    sizeFromQuery == null &&
    page.totalCount === 0 &&
    page.records.length >= safeCount &&
    page.found <= page.records.length;

  if (needsDiscover) {
    totalCount = await discoverDevicePlateCount(camera);
  }

  return {
    totalCount,
    found: page.found,
    records: page.records,
  };
}

/**
 * Busca placas por substring no número (sem filtro nativo na TrafficRedList).
 * Carrega a lista em lotes e filtra no servidor.
 */
export async function intelbrasSearchDevicePlates(
  camera: PlainCameraCredential,
  search: string,
  count: number,
  offset: number,
): Promise<DevicePlatesListResult> {
  const term = normalizePlate(search);
  if (!term) {
    return intelbrasGetDevicePlates(camera, count, offset);
  }

  const safeCount = Math.min(Math.max(count, 1), 500);
  const safeOffset = Math.max(offset, 0);

  const all = await fetchAllDevicePlates(camera);
  const filtered = all.filter((row) =>
    normalizePlate(row.plateNumber).includes(term),
  );
  const slice = filtered.slice(safeOffset, safeOffset + safeCount);

  return {
    totalCount: filtered.length,
    found: slice.length,
    records: slice,
  };
}

/** Alias do plano (`listPlates` / diagnóstico). */
export const intelbrasListPlates = intelbrasListTrafficPlates;
