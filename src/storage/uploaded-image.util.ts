import { BadRequestException } from '@nestjs/common';

import type { R2StorageService } from './r2-storage.service';

/** Mínimo decodificado para descartar uploads vazios/corrompidos. */
export const PUBLIC_FACE_UPLOAD_MIN_BYTES = 1024;

export function parseUploadedImageFile(
  file: Express.Multer.File | undefined,
  r2: R2StorageService,
): { buffer: Buffer; contentType: string; ext: string } {
  if (!file?.buffer?.length) {
    throw new BadRequestException('Envie uma imagem (campo file).');
  }

  const buffer = file.buffer;
  if (buffer.length < PUBLIC_FACE_UPLOAD_MIN_BYTES) {
    throw new BadRequestException('Imagem inválida ou muito pequena.');
  }

  const mime = file.mimetype?.trim() || 'image/jpeg';
  const ext = r2.extForImageMime(mime);
  const contentType = mime.split(';')[0]?.trim().toLowerCase() ?? 'image/jpeg';

  return { buffer, contentType, ext };
}
