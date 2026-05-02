import { ZodError } from 'zod';

export function zodFirstMessage(error: unknown): string {
  if (error instanceof ZodError && error.issues[0]?.message) {
    return error.issues[0].message;
  }
  return 'Dados inválidos.';
}
