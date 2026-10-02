import { z, ZodError } from 'zod';

/** Query string booleana opcional (`true`/`false`); ausente vira `undefined`. */
export const optionalBoolQuery = z.preprocess(
  (value) => {
    if (value === true || value === 'true') return 'true';
    if (value === false || value === 'false') return 'false';
    if (value === undefined || value === null || value === '') return undefined;
    return value;
  },
  z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
);

export function zodFirstMessage(error: unknown): string {
  if (error instanceof ZodError && error.issues[0]?.message) {
    return error.issues[0].message;
  }
  return 'Dados inválidos.';
}
