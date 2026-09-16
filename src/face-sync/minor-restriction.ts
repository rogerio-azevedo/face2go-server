import {
  isMinor,
  parseIsoDateParts,
  toIsoDateString,
} from '../common/utils/birth-date';

export const MINOR_RESTRICTION_MIN_AGE = 18;

/** Leitor com restrição só aceita quem tem data de nascimento parseável e 18+. */
export function isPersonAllowedOnReader(
  reader: { restrictMinors?: boolean | null },
  birthDate: unknown,
): boolean {
  if (!reader.restrictMinors) return true;
  const iso = toIsoDateString(birthDate);
  if (!iso || !parseIsoDateParts(iso)) return false;
  return !isMinor(iso, MINOR_RESTRICTION_MIN_AGE);
}

export function partitionReadersByMinorRestriction<
  T extends { restrictMinors?: boolean | null },
>(readers: T[], birthDate: unknown): { allowed: T[]; restricted: T[] } {
  const allowed: T[] = [];
  const restricted: T[] = [];
  for (const reader of readers) {
    if (isPersonAllowedOnReader(reader, birthDate)) allowed.push(reader);
    else restricted.push(reader);
  }
  return { allowed, restricted };
}
