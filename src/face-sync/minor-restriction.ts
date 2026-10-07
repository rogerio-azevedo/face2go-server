import {
  calculateAgeOnDate,
  parseIsoDateParts,
  toIsoDateString,
} from '../common/utils/birth-date';
import { calendarDateInOffset } from '../common/parse-access-list-datetime';
import { effectiveMinimumAccessAge } from '../database/queries/readers.queries';

export const MINOR_RESTRICTION_MIN_AGE = 18;

export type ReaderAgePolicy = {
  minimumAccessAge?: number | null;
  restrictMinors?: boolean | null;
  timezoneOffsetMinutes?: number | null;
};

export type AgeRestrictionReason =
  | 'unrestricted'
  | 'allowed'
  | 'missing_birth_date'
  | 'invalid_birth_date'
  | 'future_birth_date'
  | 'below_minimum_age';

export type AgeAccessDecision = {
  allowed: boolean;
  age: number | null;
  minimumAccessAge: number | null;
  reason: AgeRestrictionReason;
};

export function evaluatePersonAgeAccess(
  reader: ReaderAgePolicy,
  birthDate: unknown,
  now: Date = new Date(),
): AgeAccessDecision {
  const minimumAccessAge = effectiveMinimumAccessAge(reader);
  if (minimumAccessAge == null) {
    return {
      allowed: true,
      age: null,
      minimumAccessAge,
      reason: 'unrestricted',
    };
  }
  if (
    birthDate == null ||
    (typeof birthDate === 'string' && !birthDate.trim())
  ) {
    return {
      allowed: false,
      age: null,
      minimumAccessAge,
      reason: 'missing_birth_date',
    };
  }
  const iso = toIsoDateString(birthDate);
  if (!iso || !parseIsoDateParts(iso)) {
    return {
      allowed: false,
      age: null,
      minimumAccessAge,
      reason: 'invalid_birth_date',
    };
  }
  const referenceDate = calendarDateInOffset(
    reader.timezoneOffsetMinutes ?? 0,
    now,
  );
  const age = calculateAgeOnDate(iso, referenceDate);
  if (!Number.isFinite(age) || age < 0) {
    return {
      allowed: false,
      age: Number.isFinite(age) ? age : null,
      minimumAccessAge,
      reason: 'future_birth_date',
    };
  }
  if (age < minimumAccessAge) {
    return {
      allowed: false,
      age,
      minimumAccessAge,
      reason: 'below_minimum_age',
    };
  }
  return { allowed: true, age, minimumAccessAge, reason: 'allowed' };
}

/** Leitor com idade mínima só aceita data válida e idade civil suficiente. */
export function isPersonAllowedOnReader(
  reader: ReaderAgePolicy,
  birthDate: unknown,
): boolean {
  return evaluatePersonAgeAccess(reader, birthDate).allowed;
}

export type RestrictedReaderSkipReason = Exclude<
  AgeRestrictionReason,
  'allowed' | 'unrestricted'
>;

export function restrictedReaderSkipReason(
  reader: ReaderAgePolicy,
  birthDate: unknown,
): RestrictedReaderSkipReason {
  const reason = evaluatePersonAgeAccess(reader, birthDate).reason;
  return reason === 'allowed' || reason === 'unrestricted'
    ? 'below_minimum_age'
    : reason;
}

export function formatRestrictedReaderSyncError(
  readerName: string,
  reason: RestrictedReaderSkipReason,
  minimumAccessAge = MINOR_RESTRICTION_MIN_AGE,
): string {
  if (reason === 'missing_birth_date') {
    return `${readerName}: sem data de nascimento.`;
  }
  if (reason === 'invalid_birth_date') {
    return `${readerName}: data de nascimento inválida.`;
  }
  if (reason === 'future_birth_date') {
    return `${readerName}: data de nascimento futura.`;
  }
  return `${readerName}: idade inferior a ${minimumAccessAge} anos.`;
}

export function partitionReadersByMinorRestriction<T extends ReaderAgePolicy>(
  readers: T[],
  birthDate: unknown,
): { allowed: T[]; restricted: T[] } {
  const allowed: T[] = [];
  const restricted: T[] = [];
  for (const reader of readers) {
    if (isPersonAllowedOnReader(reader, birthDate)) allowed.push(reader);
    else restricted.push(reader);
  }
  return { allowed, restricted };
}
