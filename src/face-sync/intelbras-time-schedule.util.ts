import type {
  ShiftScheduleJson,
  ShiftWeekday,
} from '../database/schema/shifts';
import { normalizeZoneNameForReader } from './normalize-name-for-reader';

/** Intelbras: 0=domingo … 6=sábado. */
const WEEKDAY_TO_DEVICE: Record<ShiftWeekday, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const DEVICE_DAY_TO_WEEKDAY: Record<number, ShiftWeekday | null> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
};

const EMPTY_PERIOD = '1 00:00:00-00:00:00';

/** Normaliza HH:MM ou HH:MM:SS para HH:MM:SS. */
export function toDeviceTime(value: string): string {
  const trimmed = value.trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00`;
  throw new Error(`Horário inválido para o leitor: "${value}"`);
}

/** Doc Intelbras: só o espaço do valor vira %20; colchetes nos nomes ficam literais. */
function encodeScheduleValue(value: string): string {
  return value.replace(/ /g, '%20');
}

function periodValue(
  schedule: ShiftScheduleJson,
  day: number,
  period: number,
): string {
  const weekday = DEVICE_DAY_TO_WEEKDAY[day];
  const windows = weekday ? (schedule[weekday] ?? []) : [];
  const window = windows[period];
  return window
    ? `1 ${toDeviceTime(window.start)}-${toDeviceTime(window.end)}`
    : EMPTY_PERIOD;
}

function dayHasWindows(schedule: ShiftScheduleJson, day: number): boolean {
  const weekday = DEVICE_DAY_TO_WEEKDAY[day];
  if (!weekday) return false;
  return (schedule[weekday] ?? []).some(Boolean);
}

/**
 * Query string para configManager.cgi?action=setConfig (Intelbras/Dahua).
 * Zonas já existem no leitor — só habilita, nomeia e edita dias com horário no turno.
 * Dias sem janela no turno não são enviados (permanecem como no equipamento).
 */
export function buildAccessTimeScheduleQueryString(
  schedule: ShiftScheduleJson,
  zoneIndex: number,
  zoneName: string,
): string {
  const name = normalizeZoneNameForReader(zoneName, zoneIndex);
  const parts = [
    'action=setConfig',
    `AccessTimeSchedule[${zoneIndex}].Name=${encodeScheduleValue(name)}`,
    `AccessTimeSchedule[${zoneIndex}].Enable=true`,
  ];

  for (let day = 0; day <= 6; day++) {
    if (!dayHasWindows(schedule, day)) continue;

    for (let period = 0; period < 4; period++) {
      const raw = periodValue(schedule, day, period);
      parts.push(
        `AccessTimeSchedule[${zoneIndex}].TimeSchedule[${day}][${period}]=${encodeScheduleValue(raw)}`,
      );
    }
  }

  return parts.join('&');
}

/** @deprecated Prefer buildAccessTimeScheduleQueryString para chamadas CGI. */
export function buildAccessTimeScheduleParams(
  schedule: ShiftScheduleJson,
  zoneIndex: number,
  zoneName: string,
): URLSearchParams {
  const qs = buildAccessTimeScheduleQueryString(schedule, zoneIndex, zoneName);
  return new URLSearchParams(qs.replace(/^action=setConfig&/, ''));
}

/** Formato legado/display: TimeSections=[1,2] */
export function formatTimeSectionsQueryValue(zoneIndices: number[]): string {
  const unique = [...new Set(zoneIndices)].sort((a, b) => a - b);
  if (unique.length === 0) return '[255]';
  return `[${unique.join(',')}]`;
}

/**
 * Formato recordUpdater.cgi — o firmware expõe TimeSections[0]=255 na listagem.
 * Enviar TimeSections=[1] retorna HTTP 400 Bad Request.
 */
export function buildTimeSectionsRecordUpdaterParams(
  zoneIndices: number[],
): string {
  const unique = [...new Set(zoneIndices)].sort((a, b) => a - b);
  const indices = unique.length > 0 ? unique : [255];
  return indices.map((z, i) => `TimeSections[${i}]=${z}`).join('&');
}
