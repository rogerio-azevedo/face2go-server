import type { R2StorageService } from '../storage/r2-storage.service';
import { imageBufferToReaderBase64Jpeg } from './face-image-for-reader';
import { normalizeHikvisionFaceJpeg } from './hikvision-face-image.util';

export type ReaderFaceBrand = 'intelbras' | 'hikvision';

/** Bump da variante Intelbras invalida o cache R2 de 400×534. */
const READER_VARIANT_VERSION: Record<ReaderFaceBrand, string> = {
  intelbras: 'v2',
  hikvision: 'v1',
};

export function readerFaceVariantKey(
  masterKey: string,
  brand: ReaderFaceBrand,
): string {
  return `${masterKey}.${brand}.${READER_VARIANT_VERSION[brand]}.jpg`;
}

async function normalizeForBrand(
  masterBuffer: Buffer,
  brand: ReaderFaceBrand,
): Promise<Buffer> {
  if (brand === 'hikvision') {
    return normalizeHikvisionFaceJpeg(masterBuffer);
  }
  const base64 = await imageBufferToReaderBase64Jpeg(masterBuffer);
  return Buffer.from(base64, 'base64');
}

/**
 * Lê a variante pronta no R2; se não existir, normaliza, grava e devolve.
 */
export async function loadOrCreateReaderFaceVariant(
  r2: R2StorageService,
  masterKey: string,
  masterBuffer: Buffer,
  brand: ReaderFaceBrand,
): Promise<Buffer> {
  const key = readerFaceVariantKey(masterKey, brand);
  try {
    const got = await r2.getObjectBytes(key);
    if (got.buffer.length >= 256) return got.buffer;
  } catch {
    /* miss — gera abaixo */
  }

  const variant = await normalizeForBrand(masterBuffer, brand);
  try {
    await r2.putObject(key, variant, 'image/jpeg');
  } catch {
    /* sync segue mesmo se a gravação da variante falhar */
  }
  return variant;
}

/** Pré-computa as variantes por marca na ingestão. Falha isolada não interrompe o upload. */
export async function storeReaderFaceVariants(
  r2: R2StorageService,
  masterKey: string,
  masterBuffer: Buffer,
): Promise<void> {
  await Promise.allSettled([
    loadOrCreateReaderFaceVariant(r2, masterKey, masterBuffer, 'intelbras'),
    loadOrCreateReaderFaceVariant(r2, masterKey, masterBuffer, 'hikvision'),
  ]);
}
