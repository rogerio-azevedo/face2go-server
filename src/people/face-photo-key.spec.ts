import {
  canonicalFacePhotoKey,
  isPhotoKeyAliasedTo,
  parseBondPhotoKey,
} from './face-photo-key';

describe('face-photo-key', () => {
  const clientId = '9ccae3b8-d790-4c62-a940-3dd6ffda20a2';
  const responsibleId = 'f97bd3ef-1a98-4e55-a273-9dbafe0e6548';
  const otherId = '272ff5da-3ee2-4a73-a150-169d180d9d3a';

  it('monta o caminho canônico de responsável e membro', () => {
    expect(
      canonicalFacePhotoKey(clientId, {
        type: 'responsible',
        id: responsibleId,
      }),
    ).toBe(`responsibles/${clientId}/${responsibleId}/face.jpg`);
    expect(
      canonicalFacePhotoKey(clientId, { type: 'member', id: otherId }),
    ).toBe(`members/${clientId}/${otherId}/face.jpg`);
  });

  it('parseia o padrão novo e ignora chaves legadas', () => {
    expect(
      parseBondPhotoKey(`responsibles/${clientId}/${responsibleId}/face.jpg`),
    ).toEqual({
      kind: 'responsible',
      clientId,
      bondId: responsibleId,
    });
    expect(
      parseBondPhotoKey(`members/${clientId}/${otherId}/face.jpg`),
    ).toEqual({
      kind: 'member',
      clientId,
      bondId: otherId,
    });
    expect(
      parseBondPhotoKey(
        `${clientId}/${clientId}/responsible-invitation/abc/face.jpg`,
      ),
    ).toBeNull();
    expect(parseBondPhotoKey(null)).toBeNull();
  });

  it('detecta alias quando o bondId ou o clientId divergem', () => {
    const key = `responsibles/${clientId}/${responsibleId}/face.jpg`;
    expect(isPhotoKeyAliasedTo(key, clientId, responsibleId)).toBe(false);
    expect(isPhotoKeyAliasedTo(key, clientId, otherId)).toBe(true);
    expect(isPhotoKeyAliasedTo(key, 'other-client', responsibleId)).toBe(true);
    expect(
      isPhotoKeyAliasedTo('legacy/path/face.jpg', clientId, responsibleId),
    ).toBe(false);
  });
});
