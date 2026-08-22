import sharp, { type Sharp } from 'sharp';

export type JpegDimensions = { width: number; height: number };

export type FaceJpegReaderTarget = {
  width: number;
  height: number;
  maxBytes: number;
  minBytes?: number;
  minDimension: number;
};

const JPEG_QUALITY_STEPS = [95, 88, 82, 76, 70, 64, 58, 52];

/** Limite Hikvision para FaceDataRecord (200 KB). */
export const HIKVISION_MAX_FACE_IMAGE_BYTES = 200 * 1024;

/** Piso recomendado Hikvision DS-K1T671 (60 KB). */
export const HIKVISION_MIN_FACE_IMAGE_BYTES = 60 * 1024;

/** Dimensões alvo para terminais Hikvision (ex.: DS-K1T671). */
export const HIKVISION_FACE_WIDTH = 720;
export const HIKVISION_FACE_HEIGHT = 960;
export const HIKVISION_MIN_FACE_DIMENSION = 80;

/** Lê largura/altura de um buffer JPEG (SOF0/SOF2) sem decodificar pixels. */
export function parseJpegDimensions(buffer: Buffer): JpegDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) {
      return null;
    }

    if (marker >= 0xc0 && marker <= 0xc2) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      if (width > 0 && height > 0) {
        return { width, height };
      }
      return null;
    }

    offset += 2 + segmentLength;
  }

  return null;
}

export function isJpegBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

async function compressJpegToTarget(
  pipeline: Sharp,
  maxBytes: number,
  minBytes?: number,
): Promise<Buffer> {
  let bestUnderMax: Buffer | null = null;

  for (const quality of JPEG_QUALITY_STEPS) {
    const output = await pipeline
      .clone()
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    if (output.length <= maxBytes) {
      if (minBytes && output.length >= minBytes) {
        return output;
      }
      bestUnderMax = output;
      break;
    }
  }

  if (bestUnderMax) {
    return bestUnderMax;
  }

  const smallest = await pipeline
    .clone()
    .jpeg({ quality: 52, mozjpeg: true })
    .toBuffer();

  if (smallest.length > maxBytes) {
    throw new Error(
      `Não foi possível preparar a foto para o leitor (limite ${Math.round(maxBytes / 1024)}KB).`,
    );
  }

  return smallest;
}

async function normalizeFaceJpegForReader(
  input: Buffer,
  target: FaceJpegReaderTarget,
): Promise<Buffer> {
  if (!isJpegBuffer(input)) {
    throw new Error(
      'Formato de imagem inválido. Envie uma foto JPEG frontal do rosto.',
    );
  }

  const beforeDims = parseJpegDimensions(input);
  if (
    beforeDims &&
    (beforeDims.width < target.minDimension ||
      beforeDims.height < target.minDimension)
  ) {
    throw new Error(
      `Foto muito pequena (${beforeDims.width}×${beforeDims.height}px). ` +
        `Use uma imagem com pelo menos ${target.minDimension}×${target.minDimension}px.`,
    );
  }

  const rotated = sharp(input, { failOn: 'none' }).rotate();
  const meta = await rotated.metadata();
  const srcWidth = meta.width ?? beforeDims?.width ?? 0;
  const srcHeight = meta.height ?? beforeDims?.height ?? 0;

  const canDownscale =
    srcWidth >= target.width && srcHeight >= target.height;

  const pipeline = canDownscale
    ? rotated.resize(target.width, target.height, {
        fit: 'cover',
        position: 'centre',
        withoutEnlargement: true,
      })
    : rotated;

  return compressJpegToTarget(pipeline, target.maxBytes, target.minBytes);
}

/**
 * Normaliza foto para upload Hikvision: corrige orientação EXIF, downscale+crop
 * central 720×960 quando a origem permite (nunca amplia), JPEG até 200 KB.
 */
export async function normalizeHikvisionFaceJpeg(input: Buffer): Promise<Buffer> {
  return normalizeFaceJpegForReader(input, {
    width: HIKVISION_FACE_WIDTH,
    height: HIKVISION_FACE_HEIGHT,
    maxBytes: HIKVISION_MAX_FACE_IMAGE_BYTES,
    minBytes: HIKVISION_MIN_FACE_IMAGE_BYTES,
    minDimension: HIKVISION_MIN_FACE_DIMENSION,
  });
}
