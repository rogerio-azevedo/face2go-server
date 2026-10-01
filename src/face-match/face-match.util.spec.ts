import {
  SAME_PERSON_COSINE,
  appendFaceMatchNote,
  bestGalleryMatch,
  isSimilarFaceReaderMessage,
  similarGalleryNote,
} from './face-match.util';

describe('similarGalleryNote', () => {
  it('nomeia bloqueado quando o score passa do limiar', () => {
    expect(
      similarGalleryNote({
        faceId: 22,
        name: 'João',
        blocked: true,
        score: 0.91,
      }),
    ).toBe('Parece com João (bloqueado, ID leitor 22, 91%).');
    expect(0.91).toBeGreaterThan(SAME_PERSON_COSINE);
  });

  it('diz que ninguém ficou parecido quando o score é baixo', () => {
    expect(
      similarGalleryNote({
        faceId: 8,
        name: 'Maria',
        blocked: false,
        score: 0.28,
      }),
    ).toBe(
      'Nenhuma foto deste cliente ficou parecida (maior: Maria, 28%). O leitor pode ter confundido, ou o rosto só existe no aparelho.',
    );
  });

  it('não repete a nota', () => {
    const note = similarGalleryNote(null);
    const once = appendFaceMatchNote('Porta Saida: Foto já cadastrada.', note);
    expect(appendFaceMatchNote(once, note)).toBe(once);
  });
});

describe('bestGalleryMatch', () => {
  it('ignora o próprio faceId', () => {
    const match = bestGalleryMatch(
      [1, 0],
      [
        { faceId: 234, name: 'Thalisson', blocked: false, embedding: [1, 0] },
        { faceId: 22, name: 'João', blocked: true, embedding: [0.9, 0.1] },
      ],
      234,
    );
    expect(match?.faceId).toBe(22);
    expect(match?.blocked).toBe(true);
  });
});

describe('isSimilarFaceReaderMessage', () => {
  it('reconhece Hikvision e Intelbras', () => {
    expect(isSimilarFaceReaderMessage('Porta Saida: Foto já cadastrada.')).toBe(
      true,
    );
    expect(
      isSimilarFaceReaderMessage(
        'Porta: Este rosto já está cadastrado no leitor (foto muito parecida, comum em gêmeos).',
      ),
    ).toBe(true);
    expect(isSimilarFaceReaderMessage('Porta: timeout')).toBe(false);
  });
});
