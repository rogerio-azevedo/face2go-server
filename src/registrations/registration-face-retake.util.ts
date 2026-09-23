export const FACE_RETAKE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const FACE_RETAKE_GUIDANCE =
  'Identificamos que a sua foto não atendeu os requisitos. Procure uma área iluminada, com fundo neutro, e refaça.';

export function faceRetakeShareMessage(url: string): string {
  return `${FACE_RETAKE_GUIDANCE}\n\n${url}`;
}

export function registrationCanRetakeFace(row: {
  isActive: boolean;
  submittedAt: Date | null;
  status: string;
}): boolean {
  return (
    row.isActive &&
    row.submittedAt != null &&
    (row.status === 'draft' || row.status === 'approved')
  );
}

export function isRetakeLinkOpen(
  link: { usedAt: Date | null; expiresAt: Date },
  now = new Date(),
): boolean {
  return link.usedAt == null && link.expiresAt.getTime() > now.getTime();
}

export function firstNameOf(name: string | null): string | null {
  const part = name?.trim().split(/\s+/)[0];
  return part && part.length > 0 ? part : null;
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '23505') return true;
  if (
    'cause' in error &&
    error.cause &&
    typeof error.cause === 'object' &&
    'code' in error.cause &&
    error.cause.code === '23505'
  ) {
    return true;
  }
  return false;
}
