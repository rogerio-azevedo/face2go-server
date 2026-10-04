import sharp from 'sharp';

import type { R2StorageService } from '../storage/r2-storage.service';
import {
  loadOrCreateReaderFaceVariant,
  readerFaceVariantKey,
  storeReaderFaceVariants,
} from './face-image-variants';

type Stored = { buffer: Buffer; lastModified?: Date };

function fakeR2(objects: Record<string, Stored>) {
  const gets: string[] = [];
  const puts: { key: string; body: Buffer }[] = [];
  const r2 = {
    async headObject(key: string) {
      const obj = objects[key];
      if (!obj?.lastModified) return null;
      return { lastModified: obj.lastModified };
    },
    async getObjectBytes(key: string) {
      gets.push(key);
      const obj = objects[key];
      if (!obj) throw new Error('miss');
      return { buffer: obj.buffer };
    },
    async putObject(key: string, body: Buffer) {
      puts.push({ key, body });
      objects[key] = { buffer: body, lastModified: new Date() };
    },
  };
  return { r2: r2 as unknown as R2StorageService, gets, puts };
}

async function makeJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 720,
      height: 960,
      channels: 3,
      background: { r: 180, g: 140, b: 120 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe('loadOrCreateReaderFaceVariant', () => {
  const masterKey = 'members/c/m/face.jpg';

  it('devolve a variante quando ela é tão nova quanto o master', async () => {
    const variantKey = readerFaceVariantKey(masterKey, 'intelbras');
    const cached = Buffer.alloc(300, 1);
    const { r2, gets, puts } = fakeR2({
      [masterKey]: {
        buffer: Buffer.alloc(300, 2),
        lastModified: new Date('2026-01-01T00:00:00Z'),
      },
      [variantKey]: {
        buffer: cached,
        lastModified: new Date('2026-01-02T00:00:00Z'),
      },
    });

    const out = await loadOrCreateReaderFaceVariant(
      r2,
      masterKey,
      Buffer.alloc(300, 2),
      'intelbras',
    );

    expect(out).toBe(cached);
    expect(gets).toEqual([variantKey]);
    expect(puts).toHaveLength(0);
  });

  it('não reenvia JPEG antigo quando o master é mais novo', async () => {
    const variantKey = readerFaceVariantKey(masterKey, 'intelbras');
    const stale = Buffer.alloc(300, 9);
    const master = await makeJpeg();
    const { r2, gets, puts } = fakeR2({
      [masterKey]: {
        buffer: master,
        lastModified: new Date('2026-03-01T00:00:00Z'),
      },
      [variantKey]: {
        buffer: stale,
        lastModified: new Date('2026-01-01T00:00:00Z'),
      },
    });

    const out = await loadOrCreateReaderFaceVariant(
      r2,
      masterKey,
      master,
      'intelbras',
    );

    expect(gets).toHaveLength(0);
    expect(out.equals(stale)).toBe(false);
    expect(puts.map((put) => put.key)).toEqual([variantKey]);
    expect(puts[0]?.body.equals(stale)).toBe(false);
  });
});

describe('storeReaderFaceVariants', () => {
  it('sobrescreve a variante existente com o master atual', async () => {
    const masterKey = 'members/c/m/face.jpg';
    const intelbrasKey = readerFaceVariantKey(masterKey, 'intelbras');
    const stale = Buffer.alloc(300, 4);
    const master = await makeJpeg();
    const { r2, gets, puts } = fakeR2({
      [intelbrasKey]: {
        buffer: stale,
        lastModified: new Date('2026-01-01T00:00:00Z'),
      },
    });

    await storeReaderFaceVariants(r2, masterKey, master);

    expect(gets).toHaveLength(0);
    const rewritten = puts.find((put) => put.key === intelbrasKey);
    expect(rewritten).toBeDefined();
    expect(rewritten?.body.equals(stale)).toBe(false);
  });
});
