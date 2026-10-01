import { cosineSimilarity } from './face-geometry.util';

/** Cosseno SFace em que o OpenCV trata como a mesma pessoa. */
export const SAME_PERSON_COSINE = 0.36;

export type GalleryMatch = {
  faceId: number;
  name: string;
  blocked: boolean;
  score: number;
};

export function isSimilarFaceReaderMessage(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('foto já cadastrada') ||
    text.includes('rosto já está cadastrado')
  );
}

export function bestGalleryMatch(
  probe: number[],
  gallery: Array<{
    faceId: number;
    name: string;
    blocked: boolean;
    embedding: number[];
  }>,
  excludeFaceId: number,
): GalleryMatch | null {
  let best: GalleryMatch | null = null;
  for (const person of gallery) {
    if (person.faceId === excludeFaceId) continue;
    const score = cosineSimilarity(probe, person.embedding);
    if (!best || score > best.score) {
      best = {
        faceId: person.faceId,
        name: person.name,
        blocked: person.blocked,
        score,
      };
    }
  }
  return best;
}

function percent(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

function who(match: GalleryMatch): string {
  return match.name.trim() || `ID leitor ${match.faceId}`;
}

/** Nota anexada ao erro do leitor. Não libera o cadastro. */
export function similarGalleryNote(match: GalleryMatch | null): string {
  if (!match) {
    return 'Nenhuma foto deste cliente ficou parecida. O leitor pode ter confundido, ou o rosto só existe no aparelho.';
  }
  const pct = percent(match.score);
  if (match.score >= SAME_PERSON_COSINE) {
    const status = match.blocked ? 'bloqueado, ' : '';
    return `Parece com ${who(match)} (${status}ID leitor ${match.faceId}, ${pct}%).`;
  }
  return `Nenhuma foto deste cliente ficou parecida (maior: ${who(match)}, ${pct}%). O leitor pode ter confundido, ou o rosto só existe no aparelho.`;
}

export const FACE_COMPARE_FAILED_NOTE =
  'Não foi possível comparar com as fotos deste cliente.';

export function appendFaceMatchNote(message: string, note: string): string {
  if (message.includes(note)) return message;
  return `${message} ${note}`;
}
