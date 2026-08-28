import sharp from 'sharp';

/** Limite compatível com leitor Intelbras (decodificado). */
export const FACIAL_READER_MAX_BYTES = 100 * 1024;

/**
 * Caixas alvo em ordem de preferência.
 * Todas cabem em 600×1200 e respeitam altura ≤ 2× largura (docs Intelbras).
 */
const READER_TARGET_BOXES = [
  { width: 600, height: 800 },
  { width: 520, height: 694 },
  { width: 480, height: 640 },
  { width: 400, height: 534 },
  { width: 300, height: 400 },
] as const;

/** Mínimo documentado pela Intelbras. */
const READER_MIN_WIDTH = 150;
const READER_MIN_HEIGHT = 300;

const JPEG_QUALITY_STEPS = [92, 88, 84, 80, 76, 72, 66, 60, 52];

/**
 * Comprime/redimensiona imagem até ≤100KB JPEG; devolve Base64 cru (sem data: URL).
 * Escolhe a maior caixa válida; pipeline sharp criado uma vez, cada tentativa usa `.clone()`.
 */
export async function imageBufferToReaderBase64Jpeg(
  buf: Buffer,
): Promise<string> {
  const decoded = sharp(buf, { failOn: 'none' }).rotate();
  const meta = await decoded.metadata();
  const srcWidth = meta.width ?? 0;
  const srcHeight = meta.height ?? 0;

  if (srcWidth < READER_MIN_WIDTH || srcHeight < READER_MIN_HEIGHT) {
    throw new Error(
      `Foto muito pequena (${srcWidth}x${srcHeight}). O leitor exige ao menos ${READER_MIN_WIDTH}x${READER_MIN_HEIGHT}.`,
    );
  }

  for (const box of READER_TARGET_BOXES) {
    const pipeline = decoded.clone().resize(box.width, box.height, {
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: true,
    });
    for (const quality of JPEG_QUALITY_STEPS) {
      const out = await pipeline.clone().jpeg({ quality }).toBuffer();
      if (out.length <= FACIAL_READER_MAX_BYTES) {
        return out.toString('base64');
      }
    }
  }

  throw new Error(
    'Não foi possível compactar a foto abaixo de 100 KB para o leitor.',
  );
}
