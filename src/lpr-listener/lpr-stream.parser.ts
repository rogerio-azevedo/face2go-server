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
  /**
   * ID do evento reportado pela câmera (EventID). Mesmo valor nos dois streams
   * (eventManager JSON e snapManager flat map) — usado como chave de correlação
   * para o upsert atômico no MongoDB.
   */
  correlationEventId?: string | null;
  /** Código único de defesa por evento (DefendCode). Fallback de correlação. */
  defendCode?: string | null;
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

function normalizeCorrelationEventId(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s !== '' ? s : null;
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
  const trafficCar = asRecord(o.TrafficCar ?? o.trafficCar);

  // Correlação: EventID e DefendCode são iguais nos dois streams para o mesmo evento
  const correlationEventId = normalizeCorrelationEventId(
    pickStr(o, 'EventID', 'eventId') ??
      (o.EventID != null ? String(o.EventID) : null),
  );
  const defendCode = trafficCar != null
    ? pickStr(trafficCar, 'DefendCode', 'defendCode')
    : null;

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
      (trafficCar != null
        ? pickStr(trafficCar, 'PlateNumber', 'plateNumber')
        : null) ??
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

  // Velocidade: Vehicle > TrafficCar > SnapInfo
  let speed = vehicle != null ? pickOptionalNum(vehicle, 'Speed', 'speed') : null;
  if (speed == null && trafficCar != null) {
    speed = pickOptionalNum(trafficCar, 'Speed', 'speed');
  }

  // Direção: Vehicle > TrafficCar.DrivingDirection[0] > JunctionDirection
  let direction = vehicle != null ? pickStr(vehicle, 'Direction', 'direction') : null;
  if (direction == null && trafficCar != null) {
    const drivingDir = trafficCar['DrivingDirection'];
    if (Array.isArray(drivingDir)) {
      const first = drivingDir.find(
        (v) => v != null && String(v).trim() !== '',
      );
      direction = first != null ? String(first).trim() : null;
    }
    if (direction == null) {
      direction = pickStr(trafficCar, 'Direction', 'direction');
    }
  }
  if (direction == null) {
    direction = pickStr(o, 'JunctionDirection', 'Direction');
  }

  // Lane: SnapInfo > TrafficCar.Lane
  let laneNo =
    snap != null ? pickOptionalNum(snap, 'LanNo', 'laneNo', 'LaneNo') : null;
  if (laneNo == null && trafficCar != null) {
    laneNo = pickOptionalNum(trafficCar, 'Lane', 'LaneNo', 'laneNo');
  }

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
      : (pickStr(o, 'SnapTime') ??
          (trafficCar != null
            ? pickStr(trafficCar, 'UTC', 'CapTime')
            : null));

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

  // Cor e tipo da placa: Plate > TrafficCar > raiz
  const plateColor =
    plate != null
      ? pickStr(plate, 'PlateColor', 'plateColor', 'Color')
      : (trafficCar != null
          ? pickStr(trafficCar, 'PlateColor', 'plateColor')
          : null) ?? pickStr(o, 'PlateColor', 'plateColor');

  const plateType =
    plate != null
      ? pickStr(plate, 'PlateType', 'plateType', 'Type')
      : pickStr(o, 'PlateType');

  // Tipo e cor do veículo: Vehicle > TrafficCar > raiz
  const vehicleColor =
    vehicle != null
      ? pickStr(vehicle, 'VehicleColor', 'vehicleColor', 'Color')
      : (trafficCar != null
          ? pickStr(trafficCar, 'VehicleColor', 'vehicleColor')
          : null) ?? pickStr(o, 'VehicleColor');

  const vehicleType =
    vehicle != null
      ? pickStr(vehicle, 'VehicleType', 'vehicleType', 'type')
      : (trafficCar != null
          ? pickStr(trafficCar, 'CarType', 'VehicleType', 'vehicleType')
          : null) ?? pickStr(o, 'VehicleType', 'CarType');

  const vehicleBrand =
    vehicle != null
      ? pickStr(vehicle, 'VehicleSign', 'vehicleBrand', 'Brand')
      : (trafficCar != null
          ? pickStr(trafficCar, 'VehicleSign', 'vehicleBrand', 'Brand')
          : null) ?? pickStr(o, 'VehicleSign', 'VehicleBrand');

  return {
    plateNumber,
    plateColor,
    plateType,
    confidence,
    vehicleColor,
    vehicleType,
    vehicleBrand,
    speed,
    direction,
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
    correlationEventId,
    defendCode: defendCode || null,
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

  // Correlação: EventID e DefendCode identificam o mesmo evento físico no snap.
  const correlationEventId = normalizeCorrelationEventId(
    pickEv('EventID', 'EventBaseInfo.EventID'),
  );
  const defendCode = pickEv('TrafficCar.DefendCode') ?? null;

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

  // Lane: SnapInfo > TrafficCar.Lane
  const lane = pickEv('LanNo', 'SnapInfo.LanNo', 'TrafficCar.Lane');
  let laneNo: number | null = null;
  if (lane != undefined) {
    const num = Number(lane);
    if (Number.isFinite(num)) laneNo = num;
  }

  // Velocidade: Vehicle.Speed > TrafficCar.Speed
  const speedStr = pickEv('Speed', 'Vehicle.Speed', 'TrafficCar.Speed');
  let speed: number | null = null;
  if (speedStr != undefined) {
    const num = Number(speedStr);
    if (Number.isFinite(num)) speed = num;
  }

  // Direção: SnapInfo > TrafficCar.DrivingDirection[0] > JunctionDirection
  const direction =
    pickEv('Direction', 'SnapInfo.Direction', 'Vehicle.Direction') ??
    pickEv('TrafficCar.DrivingDirection[0]') ??
    pickEv('JunctionDirection') ??
    null;

  // Tempo: SnapInfo.SnapTime > TrafficCar.UTC
  const snapTimeRaw =
    pickEv('SnapTime', 'SnapInfo.SnapTime', 'ParkingSpace.SnapTime') ??
    pickEv('TrafficCar.UTC') ??
    null;

  return {
    plateNumber: normalizedPlate,
    plateColor:
      pickEv('PlateColor', 'Plate.PlateColor', 'TrafficParking.PlateColor', 'TrafficCar.PlateColor') ??
      null,
    plateType: pickEv('PlateType', 'Plate.PlateType') ?? null,
    confidence,
    vehicleColor:
      pickEv('VehicleColor', 'Vehicle.VehicleColor', 'TrafficCar.VehicleColor') ?? null,
    vehicleType:
      pickEv('VehicleType', 'Vehicle.VehicleType', 'TrafficCar.CarType') ?? null,
    vehicleBrand: pickEv('VehicleSign', 'Vehicle.VehicleSign') ?? null,
    speed,
    direction,
    laneNo,
    channel,
    snapTimeRaw,
    accurateTimeRaw: pickEv('AccurateTime', 'SnapInfo.AccurateTime') ?? null,
    isAllowed:
      parseBoolSnap(
        pickEv('AllowUser', 'SnapInfo.AllowUser') ??
          pickEv('TrafficCar.WhiteList.Enable'),
      ) ?? null,
    isBlocked:
      parseBoolSnap(
        pickEv('BlockUser', 'SnapInfo.BlockUser') ??
          pickEv('TrafficCar.BlackList.Enable'),
      ) ?? null,
    openStrobe:
      parseBoolSnap(pickEv('OpenStrobe', 'SnapInfo.OpenStrobe')) ?? null,
    deviceIdReported:
      pickEv('DeviceID', 'DeviceId', 'EventBaseInfo.DeviceID') ?? null,
    eventCode: code || null,
    eventAction:
      lines.get('Events[0].EventBaseInfo.Action') ??
      lines.get('Events[0].Action') ??
      null,
    correlationEventId,
    defendCode: defendCode || null,
    rawFlatSubset: buildFlatSubset(lines),
  };
}

/** Snap completo ANPR (com TrafficCar) — ignora eventos secundários do snapManager. */
export function isPrimaryLprSnapReading(
  lines: Map<string, string>,
  reading: LprStreamReadingPayload,
): boolean {
  const trafficCarPlate = lines.get('Events[0].TrafficCar.PlateNumber')?.trim();
  if (!trafficCarPlate) return false;

  return !!(
    reading.direction?.trim() ||
    reading.vehicleType?.trim() ||
    reading.isAllowed != null ||
    reading.isBlocked != null ||
    reading.laneNo != null
  );
}

/** Único snap que deve entrar no pending e ser persistido. */
export function isPersistableTrafficJunctionReading(
  lines: Map<string, string>,
  reading: LprStreamReadingPayload,
): boolean {
  if (reading.eventCode !== 'TrafficJunction') return false;
  if (!reading.correlationEventId?.trim()) return false;
  return isPrimaryLprSnapReading(lines, reading);
}
