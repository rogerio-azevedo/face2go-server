import sharp from 'sharp';

import {
  HIKVISION_MAX_FACE_IMAGE_BYTES,
  normalizeHikvisionFaceJpeg,
  parseJpegDimensions,
} from './hikvision-face-image.util';

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

describe('normalizeHikvisionFaceJpeg', () => {
  it('rejeita imagem abaixo da dimensão mínima', async () => {
    const tiny = await makeJpeg(50, 50);
    await expect(normalizeHikvisionFaceJpeg(tiny)).rejects.toThrow(
      /muito pequena/i,
    );
  });

  it('normaliza JPEG grande para até 200KB', async () => {
    const large = await makeJpeg(1200, 1600);
    const out = await normalizeHikvisionFaceJpeg(large);

    expect(out.length).toBeLessThanOrEqual(HIKVISION_MAX_FACE_IMAGE_BYTES);
    const dims = parseJpegDimensions(out);
    expect(dims).not.toBeNull();
    expect(dims!.width).toBeLessThanOrEqual(720);
    expect(dims!.height).toBeLessThanOrEqual(960);
  });

  it('não amplia imagem menor que o alvo', async () => {
    const small = await makeJpeg(200, 200);
    const out = await normalizeHikvisionFaceJpeg(small);
    const dims = parseJpegDimensions(out);

    expect(dims).not.toBeNull();
    expect(dims!.width).toBeLessThanOrEqual(200);
    expect(dims!.height).toBeLessThanOrEqual(200);
  });

  it('aceita PNG e converte para JPEG', async () => {
    const png = await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
      },
    })
      .png()
      .toBuffer();

    const out = await normalizeHikvisionFaceJpeg(png);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(out.length).toBeLessThanOrEqual(HIKVISION_MAX_FACE_IMAGE_BYTES);
  });
});
