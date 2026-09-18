import { sql, type SQL } from 'drizzle-orm';

/** Compara documento persistido (com ou sem máscara) a dígitos já normalizados. */
export function normalizedDocumentEquals(
  column: unknown,
  digits: string,
): SQL {
  return sql`regexp_replace(coalesce(${column}, ''), '\\D', '', 'g') = ${digits}`;
}
