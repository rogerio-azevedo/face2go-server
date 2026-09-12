/**
 * Firmware antigo corta o hostname na pictureURL/faceURL
 * (`condroyal2026.ddns-inte` em vez do DDNS completo). Sempre baixa
 * pelo origin já cadastrado no leitor.
 */
export function resolveHikvisionDevicePictureUrl(
  pictureUrl: string,
  baseUrl: string,
): string {
  const trimmed = pictureUrl.trim();
  const origin = baseUrl.replace(/\/$/, '');
  if (!trimmed) {
    return origin;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return `${origin}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
    const slash = withoutScheme.indexOf('/');
    if (slash === -1) {
      return origin;
    }
    return `${origin}${withoutScheme.slice(slash)}`;
  }
}
