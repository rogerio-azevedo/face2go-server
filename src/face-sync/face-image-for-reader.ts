import sharp from 'sharp';

/** Limite compatível com leitor Intelbras (decodificado). */
export const FACIAL_READER_MAX_BYTES = 100 * 1024;

/**
 * Comprime/regredimensiona imagem até ≤100KB JPEG; devolve Base64 cru (sem data: URL).
 */
export async function imageBufferToReaderBase64Jpeg(buf: Buffer): Promise<string> {
  let targetW = Math.min((await sharp(buf).metadata()).width ?? 400, 400);

  for (let shrink = 0; shrink < 8; shrink++) {
    let q = 88;
    while (q >= 38) {
      const out = await sharp(buf)
        .rotate()
        .resize({ width: Math.max(120, targetW) })
        .jpeg({ quality: q, mozjpeg: true })
        .toBuffer();
      if (out.length <= FACIAL_READER_MAX_BYTES) {
        return out.toString('base64');
      }
      q -= 8;
    }
    targetW = Math.max(120, Math.floor(targetW * 0.85));
  }

  throw new Error(
    'Não foi possível compactar a foto abaixo de 100 KB para o leitor.',
  );
}
