function sanitizeReaderName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ç/gi, 'c')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Normaliza o nome para o leitor Intelbras/Dahua (CardName).
 * Mantém todos os tokens quando cabem em `maxLength`.
 * Nomes maiores caem para primeiro + último.
 */
export function normalizeNameForFacialReader(
  fullName: string,
  maxLength = 50,
): string {
  if (!fullName || typeof fullName !== 'string') {
    return '';
  }

  const nameParts = fullName
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);

  if (nameParts.length === 0) {
    return '';
  }

  const full = sanitizeReaderName(nameParts.join(' '));
  if (!full) return '';
  if (full.length <= maxLength) return full;

  const short =
    nameParts.length >= 2
      ? sanitizeReaderName(`${nameParts[0]} ${nameParts[nameParts.length - 1]}`)
      : full;

  if (short && short.length <= maxLength) return short;

  const firstName = (short || full).split(' ')[0] ?? '';
  if (firstName.length > 0 && firstName.length <= maxLength) return firstName;
  return (short || full).substring(0, maxLength).trim();
}

/** Nome da zona de tempo no leitor (AccessTimeSchedule[n].Name). */
export function normalizeZoneNameForReader(
  name: string,
  zoneIndex: number,
  maxLength = 32,
): string {
  const trimmed = name.trim();
  const base =
    trimmed.length > 0
      ? trimmed
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/ç/gi, 'c')
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      : `Zona ${zoneIndex}`;

  return base.length > maxLength ? base.slice(0, maxLength).trim() : base;
}
