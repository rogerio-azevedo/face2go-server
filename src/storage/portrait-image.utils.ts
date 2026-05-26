import sharp from 'sharp';

/** Média de luminância (0–255) abaixo disso = retrato inutilizável no display. */
const MIN_PORTRAIT_MEAN_LUMINANCE = 12;

export async function isPortraitImageUsable(buffer: Buffer): Promise<boolean> {
  if (buffer.length < 256) {
    return false;
  }
  try {
    const stats = await sharp(buffer).stats();
    const mean =
      stats.channels.reduce((sum, channel) => sum + channel.mean, 0) /
      stats.channels.length;
    return mean >= MIN_PORTRAIT_MEAN_LUMINANCE;
  } catch {
    return false;
  }
}
