/** Rollback: reabre GET snapManager persistente nos Intelbras faciais. */
export function useIntelbrasPersistentStream(): boolean {
  return process.env.FACIAL_INTELBRAS_USE_STREAM === '1';
}

/**
 * Corta a stream facial Intelbras (POST + probe no lugar do GET infinito).
 * Default off: Pindorama continua na stream até o POST no UUID estar validado.
 */
export function skipIntelbrasPersistentStream(): boolean {
  if (useIntelbrasPersistentStream()) {
    return false;
  }
  return process.env.FACIAL_INTELBRAS_SKIP_STREAM === '1';
}
