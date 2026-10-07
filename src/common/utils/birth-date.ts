export function parseIsoDateParts(
  iso: string,
): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return null;
  }
  if (y < 1 || m < 1 || m > 12 || d < 1) return null;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const daysInMonth = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (d > (daysInMonth[m - 1] ?? 0)) return null;
  return { y, m, d };
}

export function isValidIsoBirthDate(value: unknown): value is string {
  return typeof value === 'string' && parseIsoDateParts(value) != null;
}

/** Normaliza Date ou string YYYY-MM-DD para YYYY-MM-DD. */
export function toIsoDateString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim().slice(0, 10);
    return parseIsoDateParts(trimmed) ? trimmed : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

/** Idade civil a partir de YYYY-MM-DD, sem interpretar a data como UTC. */
export function calculateAge(
  birthDate: string,
  today: Date = new Date(),
): number {
  const parts = parseIsoDateParts(birthDate);
  if (!parts) return Number.NaN;
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  let age = ty - parts.y;
  if (tm < parts.m || (tm === parts.m && td < parts.d)) {
    age -= 1;
  }
  return age;
}

/** Idade civil usando outra data civil YYYY-MM-DD como referência. */
export function calculateAgeOnDate(
  birthDate: string,
  referenceDate: string,
): number {
  const birth = parseIsoDateParts(birthDate);
  const reference = parseIsoDateParts(referenceDate);
  if (!birth || !reference) return Number.NaN;
  let age = reference.y - birth.y;
  if (
    reference.m < birth.m ||
    (reference.m === birth.m && reference.d < birth.d)
  ) {
    age -= 1;
  }
  return age;
}

export function isMinor(birthDate: string, minAge = 18, today?: Date): boolean {
  const age = calculateAge(birthDate, today);
  return Number.isFinite(age) && age >= 0 && age < minAge;
}
