import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

export function unaccentIlike(column: AnyColumn, term: string): SQL {
  const pattern = `%${term}%`;
  return sql`unaccent(${column}) ilike unaccent(${pattern})`;
}
