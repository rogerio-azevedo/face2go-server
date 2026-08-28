import sharp from 'sharp';

import { imageBufferToReaderBase64Jpeg } from './face-image-for-reader';
import { readerFaceVariantKey } from './face-image-variants';
import { normalizeHikvisionFaceJpeg } from './hikvision-face-image.util';

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 180, g: 140, b: 120 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe('imageBufferToReaderBase64Jpeg', () => {
  it('devolve JPEG base64 abaixo de 100KB', async () => {
    const large = await makeJpeg(1200, 1600);
    const b64 = await imageBufferToReaderBase64Jpeg(large);
    const out = Buffer.from(b64, 'base64');
    expect(out.length).toBeLessThanOrEqual(100 * 1024);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
  });
});

describe('readerFaceVariantKey', () => {
  it('sufixa a marca no master key', () => {
    expect(readerFaceVariantKey('a/b/face.jpg', 'intelbras')).toBe(
      'a/b/face.jpg.intelbras.jpg',
    );
    expect(readerFaceVariantKey('a/b/face.jpg', 'hikvision')).toBe(
      'a/b/face.jpg.hikvision.jpg',
    );
  });
});

describe('normalizeHikvisionFaceJpeg sem mozjpeg', () => {
  it('normaliza JPEG grande para até 200KB', async () => {
    const large = await makeJpeg(1200, 1600);
    const out = await normalizeHikvisionFaceJpeg(large);
    expect(out.length).toBeLessThanOrEqual(200 * 1024);
  });
});
