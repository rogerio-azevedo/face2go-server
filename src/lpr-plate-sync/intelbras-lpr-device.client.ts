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
  return port === 80
    ? `http://${camera.ip}`
    : `http://${camera.ip}:${port}`;
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
  } as Parameters<AxiosDigestAuth['request']>[0]) as Promise<ApiDigestResponse>;
}

function normalizePlate(plate: string): string {
  return plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
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

function lookupFromFinderText(
  text: string,
  plate: string,
): TrafficPlateLookup {
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
  const auth = new AxiosDigestAuth({
    username: camera.username,
    password: camera.plainPassword,
  });
  const base = deviceUrl(camera);
  const enc = encodeURIComponent(plate.trim());

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
      const hit = lookupFromFinderText(r.data, plate);
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
    return lookupFromFinderText(r.data, plate);
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
  const look = await intelbrasTrafficPlateLookup(camera, plate);
  if (look.plateMatched) return;

  const auth = new AxiosDigestAuth({
    username: camera.username,
    password: camera.plainPassword,
  });
  const base = deviceUrl(camera);
  const master = encodeURIComponent(
    ownerDisplayName.trim().slice(0, 128) || 'CONDUTOR',
  );
  const col = encodeURIComponent((vehicleColor ?? 'Desconhecida').trim());
  const pl = encodeURIComponent(plate.trim());

  const qsStart = encodeURIComponent(DEFAULT_INTELBRAS_VALID_DATE_START);
  const qsEnd = encodeURIComponent(DEFAULT_INTELBRAS_VALID_DATE_END);

  const url =
    `${base}/cgi-bin/recordUpdater.cgi?action=insert&name=${TRAFFIC_LIST_NAME}` +
    `&PlateNumber=${pl}&MasterOfCar=${master}&PlateColor=Gray&PlateType=Normal&VehicleColor=${col}` +
    `&BeginTime=${qsStart}&CancelTime=${qsEnd}`;

  await digestRequest(auth, { method: 'GET', url });
}

/** Remove por recno quando disponível (sem erro se já ausente ou sem RecNo). */
export async function intelbrasRemovePlate(
  camera: PlainCameraCredential,
  plate: string,
): Promise<void> {
  const look = await intelbrasTrafficPlateLookup(camera, plate);
  if (!look.plateMatched || look.recNo == null || look.recNo < 1) return;

  const auth = new AxiosDigestAuth({
    username: camera.username,
    password: camera.plainPassword,
  });
  const base = deviceUrl(camera);
  const url = `${base}/cgi-bin/recordUpdater.cgi?action=remove&name=${TRAFFIC_LIST_NAME}&recno=${encodeURIComponent(String(look.recNo))}`;
  await digestRequest(auth, { method: 'GET', url });
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

function parseFinderCounts(text: string): { totalCount: number; found: number } {
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
    const owner = (
      rec.MasterOfCar ??
      rec.Owner ??
      rec.OwnerName ??
      ''
    ).trim();
    return {
      plateNumber: (rec.PlateNumber ?? '').trim(),
      recNo: Number.isFinite(rn) && rn > 0 ? rn : null,
      owner,
    };
  });
  return { totalCount, found, records };
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
  const auth = new AxiosDigestAuth({
    username: camera.username,
    password: camera.plainPassword,
  });
  const base = deviceUrl(camera);
  const safeCount = Math.min(Math.max(count, 1), 500);
  const safeOffset = Math.max(offset, 0);

  const candidates: string[] = [
    `${base}/cgi-bin/recordFinder.cgi?action=find&name=${TRAFFIC_LIST_NAME}&count=${safeCount}&offset=${safeOffset}`,
    `${base}/cgi-bin/recordFinder.cgi?action=doSeekFind&name=${TRAFFIC_LIST_NAME}&count=${safeCount}&offset=${safeOffset}`,
  ];

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

  if (lastErr !== undefined) throw lastErr;
  throw new Error('Resposta inválida da câmera ao listar placas.');
}

/** Alias do plano (`listPlates` / diagnóstico). */
export const intelbrasListPlates = intelbrasListTrafficPlates;
