import sharp from 'sharp';

/** Limite compatível com leitor Intelbras (decodificado). */
export const FACIAL_READER_MAX_BYTES = 100 * 1024;

const JPEG_QUALITY_STEPS = [90, 82, 74, 66, 58, 50, 42];

/**
 * Comprime/redimensiona imagem até ≤100KB JPEG; devolve Base64 cru (sem data: URL).
 * Pipeline sharp criado uma vez; cada tentativa usa `.clone()`.
 */
export async function imageBufferToReaderBase64Jpeg(
  buf: Buffer,
): Promise<string> {
  const decoded = sharp(buf, { failOn: 'none' }).rotate();
  const meta = await decoded.metadata();
  let targetW = Math.min(meta.width ?? 400, 400);

  for (let shrink = 0; shrink < 8; shrink++) {
    const pipeline = decoded.clone().resize({ width: Math.max(120, targetW) });

    for (const quality of JPEG_QUALITY_STEPS) {
      const out = await pipeline.clone().jpeg({ quality }).toBuffer();
      if (out.length <= FACIAL_READER_MAX_BYTES) {
        return out.toString('base64');
      }
    }
    targetW = Math.max(120, Math.floor(targetW * 0.85));
  }

  throw new Error(
    'Não foi possível compactar a foto abaixo de 100 KB para o leitor.',
  );
}
