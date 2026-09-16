import { normalizeCpf } from '../../common/utils/document';

export { normalizeCpf };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes('@');
}

export function normalizeLoginIdentifier(identifier: string): {
  kind: 'email' | 'cpf';
  value: string;
} {
  const trimmed = identifier.trim();
  if (isEmailIdentifier(trimmed)) {
    return { kind: 'email', value: normalizeEmail(trimmed) };
  }
  return { kind: 'cpf', value: normalizeCpf(trimmed) };
}
