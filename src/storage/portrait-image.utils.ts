import sharp from 'sharp';

/** Média de luminância (0–255) abaixo disso = retrato inutilizável no display. */
const MIN_PORTRAIT_MEAN_LUMINANCE = 12;

/** Amostra reduzida: evita decodificar o JPEG inteiro só para a média. */
const LUMINANCE_SAMPLE_SIZE = 64;

export async function isPortraitImageUsable(buffer: Buffer): Promise<boolean> {
  if (buffer.length < 256) {
    return false;
  }
  try {
    const stats = await sharp(buffer, { failOn: 'none' })
      .resize(LUMINANCE_SAMPLE_SIZE, LUMINANCE_SAMPLE_SIZE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .stats();
    const mean =
      stats.channels.reduce((sum, channel) => sum + channel.mean, 0) /
      stats.channels.length;
    return mean >= MIN_PORTRAIT_MEAN_LUMINANCE;
  } catch {
    return false;
  }
}
