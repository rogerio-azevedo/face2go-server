/**
 * Gera slug URL-safe a partir do nome (máximo `maxLength` caracteres).
 */
export function slugifyName(name: string, maxLength = 80): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slug = base.slice(0, maxLength);
  return slug || 'empresa';
}
