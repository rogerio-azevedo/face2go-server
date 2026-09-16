import { BadRequestException } from '@nestjs/common';

import { isValidCpfOrCnpj } from '../common/utils/document';
import { parseIsoDateParts } from '../common/utils/birth-date';
import type { ResolvedRegistrationFieldsConfig } from './registration-fields-config';

function coerceTrimmedString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function applyScalarRule(
  rule: 'required' | 'optional' | 'hidden',
  raw: string,
  label: string,
  validate?: (value: string) => string | null,
): string | null {
  const value = raw.trim();
  if (rule === 'hidden') return null;
  if (!value) {
    if (rule === 'required') {
      throw new BadRequestException(`Informe ${label}.`);
    }
    return null;
  }
  if (validate) {
    const error = validate(value);
    if (error) throw new BadRequestException(error);
  }
  return value;
}

export type NormalizedRegistrationFields = {
  document: string | null;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  additionalData: { block?: string; unit?: string; room?: string } | null;
};

export function normalizeRegistrationFields(
  config: ResolvedRegistrationFieldsConfig,
  input: {
    document?: string;
    phone?: string;
    email?: string;
    birthDate?: string | null;
    additionalData?: Record<string, unknown>;
  },
): NormalizedRegistrationFields {
  const document = applyScalarRule(
    config.document,
    input.document ?? '',
    'o CPF ou CNPJ',
    (value) => (isValidCpfOrCnpj(value) ? null : 'CPF ou CNPJ inválido.'),
  );
  const phone = applyScalarRule(
    config.phone,
    input.phone ?? '',
    'o telefone',
    (value) => (value.length >= 8 ? null : 'Informe um telefone válido.'),
  );
  const email = applyScalarRule(
    config.email,
    (input.email ?? '').toLowerCase(),
    'o e-mail',
    (value) => (EMAIL_RE.test(value) ? null : 'E-mail inválido.'),
  );
  const birthDate = applyScalarRule(
    config.birthDate,
    input.birthDate ?? '',
    'a data de nascimento',
    (value) =>
      parseIsoDateParts(value) ? null : 'Data inválida (YYYY-MM-DD).',
  );

  const additional: { block?: string; unit?: string; room?: string } = {};

  const block = applyScalarRule(
    config.block,
    coerceTrimmedString(input.additionalData?.block),
    'o bloco',
  );
  if (block) additional.block = block;

  const unit = applyScalarRule(
    config.unit,
    coerceTrimmedString(input.additionalData?.unit),
    'a unidade',
  );
  if (unit) additional.unit = unit;

  const room = applyScalarRule(
    config.room,
    coerceTrimmedString(input.additionalData?.room),
    'a sala',
  );
  if (room) additional.room = room;

  return {
    document,
    phone,
    email: email ? email.toLowerCase() : null,
    birthDate,
    additionalData: Object.keys(additional).length > 0 ? additional : null,
  };
}

export function mergeHiddenRegistrationFields(
  config: ResolvedRegistrationFieldsConfig,
  normalized: NormalizedRegistrationFields,
  existing: {
    document: string | null;
    phone: string | null;
    email: string | null;
    birthDate: string | null;
    additionalData: { block?: string; unit?: string; room?: string } | null;
  },
): NormalizedRegistrationFields {
  const extras = { ...(existing.additionalData ?? {}) };
  if (config.block !== 'hidden') {
    if (normalized.additionalData?.block)
      extras.block = normalized.additionalData.block;
    else delete extras.block;
  }
  if (config.unit !== 'hidden') {
    if (normalized.additionalData?.unit)
      extras.unit = normalized.additionalData.unit;
    else delete extras.unit;
  }
  if (config.room !== 'hidden') {
    if (normalized.additionalData?.room)
      extras.room = normalized.additionalData.room;
    else delete extras.room;
  }
  return {
    document:
      config.document === 'hidden' ? existing.document : normalized.document,
    phone: config.phone === 'hidden' ? existing.phone : normalized.phone,
    email: config.email === 'hidden' ? existing.email : normalized.email,
    birthDate:
      config.birthDate === 'hidden' ? existing.birthDate : normalized.birthDate,
    additionalData: Object.keys(extras).length > 0 ? extras : null,
  };
}
