const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function civilToUtcMs(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timezoneOffsetMinutes: number,
): number {
  return (
    Date.UTC(year, monthIndex, day, hour, minute, second, ms) -
    timezoneOffsetMinutes * 60_000
  );
}

/**
 * Interpreta bound de listagem no fuso do cliente (`timezoneOffsetMinutes`
 * somado ao UTC, igual à exibição da tabela).
 *
 * - `YYYY-MM-DD`: início 00:00:00.000 / fim 23:59:59.999
 * - `YYYY-MM-DDTHH:mm`: início no minuto; fim inclui o minuto (59.999s)
 * - ISO com `Z` ou offset: instante absoluto
 */
export function parseAccessListDateBound(
  value: string | undefined,
  bound: 'start' | 'end',
  timezoneOffsetMinutes = 0,
): Date | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) {
    const instant = new Date(raw);
    return Number.isNaN(instant.getTime()) ? undefined : instant;
  }

  const dateOnly = DATE_ONLY.exec(raw);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const monthIndex = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    if (bound === 'end') {
      return new Date(
        civilToUtcMs(
          year,
          monthIndex,
          day,
          23,
          59,
          59,
          999,
          timezoneOffsetMinutes,
        ),
      );
    }
    return new Date(
      civilToUtcMs(year, monthIndex, day, 0, 0, 0, 0, timezoneOffsetMinutes),
    );
  }

  const dateTime = DATE_TIME.exec(raw);
  if (dateTime) {
    const year = Number(dateTime[1]);
    const monthIndex = Number(dateTime[2]) - 1;
    const day = Number(dateTime[3]);
    const hour = Number(dateTime[4]);
    const minute = Number(dateTime[5]);
    const hasSeconds = dateTime[6] != null;
    const second = hasSeconds ? Number(dateTime[6]) : bound === 'end' ? 59 : 0;
    const ms = dateTime[7]
      ? Number(dateTime[7].padEnd(3, '0'))
      : bound === 'end' && !hasSeconds
        ? 999
        : 0;
    return new Date(
      civilToUtcMs(
        year,
        monthIndex,
        day,
        hour,
        minute,
        second,
        ms,
        timezoneOffsetMinutes,
      ),
    );
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? undefined : fallback;
}

export function createdAtRangeFilter(
  startDate?: string,
  endDate?: string,
  timezoneOffsetMinutes = 0,
): Record<string, Date> | undefined {
  const start = parseAccessListDateBound(
    startDate,
    'start',
    timezoneOffsetMinutes,
  );
  const end = parseAccessListDateBound(endDate, 'end', timezoneOffsetMinutes);
  if (start && end) {
    return { $gte: start, $lte: end };
  }
  if (start) {
    return { $gte: start };
  }
  if (end) {
    return { $lte: end };
  }
  return undefined;
}
