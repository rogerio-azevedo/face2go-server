/**
 * Normaliza o nome para o leitor Intelbras/Dahua (CardName).
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

  let normalizedName = '';
  if (nameParts.length === 1) {
    normalizedName = nameParts[0];
  } else if (nameParts.length === 2) {
    normalizedName = `${nameParts[0]} ${nameParts[1]}`;
  } else {
    normalizedName = `${nameParts[0]} ${nameParts[nameParts.length - 1]}`;
  }

  normalizedName = normalizedName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ç/gi, 'c')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  if (normalizedName.length > maxLength) {
    const firstName = normalizedName.split(' ')[0];
    if (firstName.length <= maxLength) {
      normalizedName = firstName;
    } else {
      normalizedName = normalizedName.substring(0, maxLength).trim();
    }
  }

  return normalizedName;
}
