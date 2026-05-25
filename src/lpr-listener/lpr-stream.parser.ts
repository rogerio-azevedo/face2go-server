/**
 * Parsing de eventos ANPR nos streams Intelbras (eventManager JSON + SnapManager multipart flat).
 *
 * Os nomes dos campos variam por modelo/firmware: cobrimos padrões conhecidos e chaves Tollgate/API Push.
 */

import type { VideoEvent } from '../face-listener/video-stream.parser';

/** Leitura ANPR normalizada — fonte pode ser CGI stream ou objeto JSON parecido com TollgateInfo. */
export type LprStreamReadingPayload = {
  plateNumber: string | null;
  plateColor?: string | null;
  plateType?: string | null;
  confidence?: number | null;
  vehicleColor?: string | null;
  vehicleType?: string | null;
  vehicleBrand?: string | null;
  speed?: number | null;
  direction?: string | null;
  laneNo?: number | null;
  channel?: number | null;
  snapTimeRaw?: string | null;
  accurateTimeRaw?: string | null;
  isAllowed?: boolean | null;
  isBlocked?: boolean | null;
  openStrobe?: boolean | null;
  deviceIdReported?: string | null;
  eventCode?: string | null;
  eventAction?: string | null;
  /** Algumas linhas flat do último multipart (debug). */
  rawFlatSubset?: Record<string, string>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    !(v instanceof Date)
    ? (v as Record<string, unknown>)
    : null;
}

function pickStr(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const raw = o[k];
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (s !== '') return s;
  }
  return null;
}

function pickOptionalNum(
  o: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const k of keys) {
    const raw = o[k];
    if (raw === undefined || raw === null) continue;
    const n = typeof raw === 'number' ? raw : Number(String(raw));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickOptionalBool(
  o: Record<string, unknown>,
  ...keys: string[]
): boolean | null {
  for (const k of keys) {
    const raw = o[k];
    if (raw === undefined || raw === null) continue;
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    const s = String(raw).toLowerCase().trim();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
  }
  return null;
}

function looksLikeTrafficCode(code: string): boolean {
  const c = code.toLowerCase();
  return (
    c.includes('traffic') ||
    c.includes('anpr') ||
    c.includes('toll') ||
    c.includes('vehicle') ||
    c.includes('parking') ||
    c.includes('plate') ||
    c === 'lpr' ||
    c.includes('tolgate') ||
    c.includes('tollgate')
  );
}

/** Extrai leitura a partir do JSON da linha `Code=…;…;data={…}` no eventManager. */
export function extractLprReadingFromVideoEvent(
  event: VideoEvent,
): LprStreamReadingPayload | null {
  const code = event.code ?? '';
  const extracted = mergeLprFragments(extractFromJsonData(event.data), {
    eventCode: code,
    eventAction: String(event.action ?? ''),
  });

  const hasPlate =
    extracted.plateNumber != null &&
    extracted.plateNumber !== '' &&
    extracted.plateNumber.toLowerCase() !== 'unknown';

  if (hasPlate) {
    return extracted;
  }

  if (looksLikeTrafficCode(code)) {
    return mergeLprFragments(extracted, {
      plateNumber: extracted.plateNumber ?? '(sem placa reconhecida)',
    });
  }

  const deep = mergeLprFragments(
    extracted,
    extractPlateFromAmbiguousNested(event.data),
  );

  const deepPlate =
    deep.plateNumber != null &&
    deep.plateNumber !== '' &&
    deep.plateNumber !== '(sem placa reconhecida)';

  if (deepPlate) {
    return deep;
  }

  return null;
}

function extractPlateFromAmbiguousNested(
  data: unknown,
): Partial<LprStreamReadingPayload> {
  const flat = flattenUnknown(data, '', 6);
  for (const [k, val] of Object.entries(flat)) {
    const key = k.toLowerCase();
    if (
      (key.endsWith('.platenumber') ||
        key === 'platenumber' ||
        key.endsWith('plateno')) &&
      val.trim() !== ''
    ) {
      return { plateNumber: val };
    }
  }
  return {};
}

function flattenUnknown(
  v: unknown,
  prefix: string,
  depth: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (depth <= 0) return out;

  const o = asRecord(v);
  if (!o) return out;

  for (const [k, val] of Object.entries(o)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (val === undefined || val === null) continue;
    if (
      typeof val === 'string' ||
      typeof val === 'number' ||
      typeof val === 'boolean'
    ) {
      out[path] = String(val).trim();
    } else if (asRecord(val)) {
      Object.assign(out, flattenUnknown(val, path, depth - 1));
    }
  }
  return out;
}

function mergeLprFragments(
  base: LprStreamReadingPayload,
  patch: Partial<LprStreamReadingPayload>,
): LprStreamReadingPayload {
  const plateNumber =
    patch.plateNumber !== undefined ? patch.plateNumber : base.plateNumber;
  return { ...base, ...patch, plateNumber };
}

function extractFromJsonData(data: unknown): LprStreamReadingPayload {
  const empty: LprStreamReadingPayload = {
    plateNumber: null,
  };

  const o = asRecord(data);
  if (!o) return empty;

  const plate = asRecord(o.Plate ?? o.plate ?? o.licensePlate ?? o.license);
  const snap =
    asRecord(o.SnapInfo ?? o.snapInfo) ??
    asRecord(asRecord(o.Snap)?.info) ??
    null;
  const vehicle = asRecord(o.Vehicle ?? o.vehicle ?? o.car);

  let plateNumber =
    plate != null
      ? pickStr(plate, 'PlateNumber', 'plateNumber', 'Number')
      : null;

  if (
    plateNumber == null ||
    plateNumber === '' ||
    plateNumber.toLowerCase() === 'unknown'
  ) {
    plateNumber =
      pickStr(o, 'PlateNumber', 'plateNumber', 'plate_no', 'LicensePlate') ??
      plateNumber;
  }

  const deviceIdReported =
    pickStr(o, 'DeviceID', 'device_id', 'DeviceId') ??
    (plate?.DeviceID != null ? String(plate.DeviceID) : null) ??
    null;

  let confidence =
    plate != null
      ? pickOptionalNum(
          plate,
          'Confidence',
          'confidence',
          'ConfidenceLevel',
          'ConfidenceNum',
        )
      : null;
  if (confidence == null) {
    confidence = pickOptionalNum(o, 'Confidence', 'confidence');
  }

  let channel = pickOptionalNum(o, 'Channel', 'channel');
  if (channel == null && plate != null) {
    channel = pickOptionalNum(plate, 'Channel', 'channel');
  }

  let speed = vehicle != null ? pickOptionalNum(vehicle, 'Speed', 'speed') : null;

  let direction = vehicle != null ? pickStr(vehicle, 'Direction', 'direction') : null;

  let laneNo =
    snap != null ? pickOptionalNum(snap, 'LanNo', 'laneNo', 'LaneNo') : null;

  if (
    snap?.Direction !== undefined &&
    snap.Direction !== null &&
    (typeof snap.Direction === 'string' || typeof snap.Direction === 'number')
  ) {
    direction = String(snap.Direction).trim();
  }

  if (snap != null && speed == null && asRecord(snap)) {
    speed = pickOptionalNum(asRecord(snap)!, 'Speed');
  }

  const snapTimeRaw =
    snap != null && asRecord(snap)
      ? pickStr(asRecord(snap)!, 'SnapTime', 'snapTime')
      : pickStr(o, 'SnapTime');

  const accurateTimeRaw =
    snap != null && asRecord(snap)
      ? pickStr(asRecord(snap)!, 'AccurateTime', 'accurateTime')
      : null;

  let isAllowed =
    snap != null && asRecord(snap)
      ? pickOptionalBool(asRecord(snap)!, 'AllowUser', 'allowUser')
      : null;
  let isBlocked =
    snap != null && asRecord(snap)
      ? pickOptionalBool(asRecord(snap)!, 'BlockUser', 'blockUser')
      : null;

  let openStrobe =
    snap != null && asRecord(snap)
      ? pickOptionalBool(asRecord(snap)!, 'OpenStrobe', 'openStrobe')
      : null;

  if (!snap || !asRecord(snap)) {
    isAllowed ??= pickOptionalBool(o, 'AllowUser');
    isBlocked ??= pickOptionalBool(o, 'BlockUser');
    openStrobe ??= pickOptionalBool(o, 'OpenStrobe');
  }

  return {
    plateNumber,
    plateColor:
      plate != null
        ? pickStr(plate, 'PlateColor', 'plateColor', 'Color')
        : pickStr(o, 'PlateColor', 'plateColor'),
    plateType:
      plate != null
        ? pickStr(plate, 'PlateType', 'plateType', 'Type')
        : pickStr(o, 'PlateType'),
    confidence,
    vehicleColor:
      vehicle != null
        ? pickStr(vehicle, 'VehicleColor', 'vehicleColor', 'Color')
        : pickStr(o, 'VehicleColor'),
    vehicleType:
      vehicle != null
        ? pickStr(vehicle, 'VehicleType', 'vehicleType', 'type')
        : pickStr(o, 'VehicleType'),
    vehicleBrand:
      vehicle != null
        ? pickStr(vehicle, 'VehicleSign', 'vehicleBrand', 'Brand')
        : pickStr(o, 'VehicleSign', 'VehicleBrand'),
    speed,
    direction: direction ?? pickStr(o, 'Direction'),
    laneNo,
    channel:
      channel ??
      pickOptionalNum(o, 'LanNo') ??
      (snap != null && asRecord(snap)
        ? pickOptionalNum(asRecord(snap)!, 'Channel')
        : null),
    snapTimeRaw,
    accurateTimeRaw,
    isAllowed,
    isBlocked,
    openStrobe,
    deviceIdReported,
  };
}

function buildFlatSubset(
  lines: Map<string, string>,
  maxEntries = 40,
): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of lines) {
    if (n >= maxEntries) break;
    if (
      k.includes('Plate') ||
      k.includes('Traffic') ||
      k.includes('Vehicle') ||
      k.includes('Snap') ||
      k.includes('ANPR') ||
      k.includes('Toll')
    ) {
      out[k] = v;
      n += 1;
    }
  }
  return out;
}

function parseBoolSnap(v: string | undefined): boolean | null {
  if (v == null || v.trim() === '') return null;
  const l = v.toLowerCase().trim();
  if (l === 'true' || l === '1') return true;
  if (l === 'false' || l === '0') return false;
  return null;
}

/**
 * Extrai ANPR das linhas `Events[0].…=` do multipart do SnapManager (mesmo formato do leitor facial).
 */
export function snapFlatMapToLprReading(
  lines: Map<string, string>,
): LprStreamReadingPayload | null {
  const code =
    lines.get('Events[0].EventBaseInfo.Code') ??
    lines.get('Events[0].Code') ??
    '';

  const pickEv = (...suffixes: string[]): string | undefined => {
    for (const suf of suffixes) {
      const k = `Events[0].${suf}`;
      const v = lines.get(k);
      if (v != null && v.trim() !== '') return v;
    }
    return undefined;
  };

  let plateRaw =
    pickEv(
      'PlateNumber',
      'TrafficParking.PlateNumber',
      'TrafficCar.PlateNumber',
      'ParkingSpace.PlateNumber',
      'ANPR.PlateNumber',
      'Plate.PlateNumber',
    ) ?? undefined;

  if (!plateRaw) {
    for (const [k, v] of lines) {
      if (!k.startsWith('Events[0].')) continue;
      if (/platenumber/i.test(k) && v.trim() !== '') {
        plateRaw = v;
        break;
      }
    }
  }

  const trafficLike = looksLikeTrafficCode(code) || plateRaw !== undefined;

  if (!trafficLike) {
    return null;
  }

  const normalizedPlate =
    plateRaw?.trim() ??
    (looksLikeTrafficCode(code) ? '(sem placa reconhecida)' : null);

  if (normalizedPlate == null) {
    return null;
  }

  const cn = pickEv('Confidence', 'Plate.Confidence', 'ANPR.Confidence');
  let confidence: number | null = null;
  if (cn != undefined) {
    const num = Number(cn);
    if (Number.isFinite(num)) confidence = num;
  }

  const ch = pickEv('Channel', 'EventBaseInfo.Channel');
  let channel: number | null = null;
  if (ch != undefined) {
    const num = Number(ch);
    if (Number.isFinite(num)) channel = num;
  }

  const lane = pickEv('LanNo', 'SnapInfo.LanNo');
  let laneNo: number | null = null;
  if (lane != undefined) {
    const num = Number(lane);
    if (Number.isFinite(num)) laneNo = num;
  }

  const speedStr = pickEv('Speed', 'Vehicle.Speed', 'TrafficCar.Speed');
  let speed: number | null = null;
  if (speedStr != undefined) {
    const num = Number(speedStr);
    if (Number.isFinite(num)) speed = num;
  }

  return {
    plateNumber: normalizedPlate,
    plateColor:
      pickEv('PlateColor', 'Plate.PlateColor', 'TrafficParking.PlateColor') ??
      null,
    plateType: pickEv('PlateType', 'Plate.PlateType') ?? null,
    confidence,
    vehicleColor: pickEv('VehicleColor', 'Vehicle.VehicleColor') ?? null,
    vehicleType: pickEv('VehicleType', 'Vehicle.VehicleType') ?? null,
    vehicleBrand: pickEv('VehicleSign', 'Vehicle.VehicleSign') ?? null,
    speed,
    direction:
      pickEv('Direction', 'SnapInfo.Direction', 'Vehicle.Direction') ?? null,
    laneNo,
    channel,
    snapTimeRaw:
      pickEv('SnapTime', 'SnapInfo.SnapTime', 'ParkingSpace.SnapTime') ?? null,
    accurateTimeRaw: pickEv('AccurateTime', 'SnapInfo.AccurateTime') ?? null,
    isAllowed:
      parseBoolSnap(pickEv('AllowUser', 'SnapInfo.AllowUser')) ?? null,
    isBlocked:
      parseBoolSnap(pickEv('BlockUser', 'SnapInfo.BlockUser')) ?? null,
    openStrobe:
      parseBoolSnap(pickEv('OpenStrobe', 'SnapInfo.OpenStrobe')) ?? null,
    deviceIdReported:
      pickEv('DeviceID', 'DeviceId', 'EventBaseInfo.DeviceID') ?? null,
    eventCode: code || null,
    eventAction:
      lines.get('Events[0].EventBaseInfo.Action') ??
      lines.get('Events[0].Action') ??
      null,
    rawFlatSubset: buildFlatSubset(lines),
  };
}
