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
 * Variante só vale se foi gravada depois (ou junto) do master atual.
 * Force sync baixa o master novo; uma variante antiga reenviaria a foto velha.
 */
async function variantIsFresh(
  r2: R2StorageService,
  variantKey: string,
  masterKey: string,
): Promise<boolean> {
  const [variantHead, masterHead] = await Promise.all([
    r2.headObject(variantKey),
    r2.headObject(masterKey),
  ]);
  const variantAt = variantHead?.lastModified?.getTime();
  const masterAt = masterHead?.lastModified?.getTime();
  if (variantAt == null || masterAt == null) return false;
  return variantAt >= masterAt;
}

async function writeReaderFaceVariant(
  r2: R2StorageService,
  masterKey: string,
  masterBuffer: Buffer,
  brand: ReaderFaceBrand,
): Promise<Buffer> {
  const variant = await normalizeForBrand(masterBuffer, brand);
  const key = readerFaceVariantKey(masterKey, brand);
  try {
    await r2.putObject(key, variant, 'image/jpeg');
  } catch {
    /* sync segue mesmo se a gravação da variante falhar */
  }
  return variant;
}

/**
 * Lê a variante pronta no R2 se ela não for mais velha que o master;
 * senão normaliza o buffer atual, grava e devolve.
 */
export async function loadOrCreateReaderFaceVariant(
  r2: R2StorageService,
  masterKey: string,
  masterBuffer: Buffer,
  brand: ReaderFaceBrand,
): Promise<Buffer> {
  const key = readerFaceVariantKey(masterKey, brand);
  if (await variantIsFresh(r2, key, masterKey)) {
    try {
      const got = await r2.getObjectBytes(key);
      if (got.buffer.length >= 256) return got.buffer;
    } catch {
      /* miss — gera abaixo */
    }
  }

  return writeReaderFaceVariant(r2, masterKey, masterBuffer, brand);
}

/** Regrava as variantes a partir do master atual. Falha isolada não interrompe o upload. */
export async function storeReaderFaceVariants(
  r2: R2StorageService,
  masterKey: string,
  masterBuffer: Buffer,
): Promise<void> {
  await Promise.allSettled([
    writeReaderFaceVariant(r2, masterKey, masterBuffer, 'intelbras'),
    writeReaderFaceVariant(r2, masterKey, masterBuffer, 'hikvision'),
  ]);
}
