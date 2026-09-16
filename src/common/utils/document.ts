/** Remove caracteres não numéricos. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/** CPF normalizado (somente dígitos). */
export function normalizeCpf(value: string): string {
  return onlyDigits(value);
}

function allSameDigits(digits: string): boolean {
  return digits.length > 0 && /^(\d)\1+$/.test(digits);
}

function mod11CheckDigit(digits: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += Number(digits[i]) * (weights[i] ?? 0);
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** CPF com 11 dígitos e dígitos verificadores válidos. */
export function isValidCpf(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || allSameDigits(digits)) return false;
  const d1 = mod11CheckDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== Number(digits[9])) return false;
  const d2 = mod11CheckDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d2 === Number(digits[10]);
}

/** CNPJ com 14 dígitos e dígitos verificadores válidos. */
export function isValidCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 14 || allSameDigits(digits)) return false;
  const d1 = mod11CheckDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== Number(digits[12])) return false;
  const d2 = mod11CheckDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d2 === Number(digits[13]);
}

export function isValidCpfOrCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

/** Formata CNPJ como XX.XXX.XXX/XXXX-XX (máx. 14 dígitos). */
export function formatCnpj(value: string): string {
  const digits = onlyDigits(value).slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  }
  if (digits.length <= 12) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}
