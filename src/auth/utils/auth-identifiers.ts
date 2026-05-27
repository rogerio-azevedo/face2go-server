export function normalizeCpf(value: string): string {
  return value.replace(/\D/g, '');
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
    return { kind: 'email', value: trimmed.toLowerCase() };
  }
  return { kind: 'cpf', value: normalizeCpf(trimmed) };
}
