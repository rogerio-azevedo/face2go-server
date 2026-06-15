export type ClientAppBrand = 'ienh' | 'face2go';

export function resolveClientAppBrand(
  ienhFilialCode: number | null | undefined,
): ClientAppBrand {
  return ienhFilialCode != null ? 'ienh' : 'face2go';
}
