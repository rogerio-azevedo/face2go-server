const CANONICAL_FACE_PHOTO_KEY =
  /^(responsibles|members)\/([^/]+)\/([^/]+)\/face\.jpg$/;

export type FacePhotoBondKind = 'responsible' | 'member';

export type ParsedBondPhotoKey = {
  kind: FacePhotoBondKind;
  clientId: string;
  bondId: string;
};

export function canonicalFacePhotoKey(
  clientId: string,
  target: { type: FacePhotoBondKind; id: string },
): string {
  const prefix = target.type === 'responsible' ? 'responsibles' : 'members';
  return `${prefix}/${clientId}/${target.id}/face.jpg`;
}

/** Interpreta o padrão novo `responsibles|members/<clientId>/<bondId>/face.jpg`. */
export function parseBondPhotoKey(
  key: string | null | undefined,
): ParsedBondPhotoKey | null {
  if (!key) return null;
  const match = CANONICAL_FACE_PHOTO_KEY.exec(key);
  if (!match) return null;
  return {
    kind: match[1] === 'responsibles' ? 'responsible' : 'member',
    clientId: match[2],
    bondId: match[3],
  };
}

/** True quando a chave é do padrão novo e não pertence a este vínculo. */
export function isPhotoKeyAliasedTo(
  key: string,
  clientId: string,
  bondId: string,
): boolean {
  const parsed = parseBondPhotoKey(key);
  if (!parsed) return false;
  return parsed.clientId !== clientId || parsed.bondId !== bondId;
}
