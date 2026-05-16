/** Fases do parser multipart com corpo binário (SnapManager Intelbras). */
export type SnapMultipartPhase = 'seek_boundary' | 'read_headers' | 'read_body';

/** Estado por leitor para montar partes `multipart/mixed` do snapManager. */
export type SnapMultipartAccumState = {
  phase: SnapMultipartPhase;
  /** Buffer residual (início do próximo boundary / headers / corpo incompleto). */
  buf: Buffer;
  contentType: string | null;
  contentLength: number | null;
  bodyReceived: number;
  /** Corpo binário acumulado da parte atual. */
  bodyParts: Buffer[];
};

export function createSnapMultipartState(): SnapMultipartAccumState {
  return {
    phase: 'seek_boundary',
    buf: Buffer.alloc(0),
    contentType: null,
    contentLength: null,
    bodyReceived: 0,
    bodyParts: [],
  };
}
