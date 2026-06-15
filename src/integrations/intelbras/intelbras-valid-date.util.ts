/** Datas padrão cadastro permanente Intelbras/Dahua. */
export const DEFAULT_INTELBRAS_VALID_DATE_START =
  '2000-01-01 00:00:00' as const;
export const DEFAULT_INTELBRAS_VALID_DATE_END = '2100-12-31 23:59:59' as const;

/** Formata Date para o padrão Intelbras: "YYYY-MM-DD HH:mm:ss". */
export function dateToIntelbrasFormat(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${min}:${s}`;
}
