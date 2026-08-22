/** Datas padrão cadastro permanente Hikvision (ISO local). */
export const DEFAULT_HIKVISION_VALID_DATE_START = '2000-01-01T00:00:00';
export const DEFAULT_HIKVISION_VALID_DATE_END = '2036-12-31T23:59:59';

/** Formata Date para o padrão ISAPI Hikvision com offset local. */
export function dateToHikvisionFormat(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
