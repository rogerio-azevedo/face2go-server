import { z } from 'zod';

export const FIELD_RULES = ['required', 'optional', 'hidden'] as const;
export type FieldRule = (typeof FIELD_RULES)[number];

export const CONFIGURABLE_FIELDS = [
  'document',
  'phone',
  'email',
  'birthDate',
  'block',
  'unit',
  'room',
] as const;
export type ConfigurableField = (typeof CONFIGURABLE_FIELDS)[number];

export type ResolvedRegistrationFieldsConfig = Record<
  ConfigurableField,
  FieldRule
>;

export const fieldRuleSchema = z.enum(FIELD_RULES);
export const configurableFieldSchema = z.enum(CONFIGURABLE_FIELDS);

export const registrationFieldsConfigSchema = z.object({
  document: fieldRuleSchema,
  phone: fieldRuleSchema,
  email: fieldRuleSchema,
  birthDate: fieldRuleSchema,
  block: fieldRuleSchema,
  unit: fieldRuleSchema,
  room: fieldRuleSchema,
});

export const updateRegistrationFieldsConfigSchema =
  registrationFieldsConfigSchema.partial();

export type UpdateRegistrationFieldsConfig = z.infer<
  typeof updateRegistrationFieldsConfigSchema
>;

const LOCATION_FIELDS_BY_TYPE: Record<string, ConfigurableField[]> = {
  condominium: ['block', 'unit'],
  office: ['room'],
  clinic: ['room'],
};

export function locationFieldsForClientType(
  clientType: string,
): ConfigurableField[] {
  return LOCATION_FIELDS_BY_TYPE[clientType] ?? [];
}

export function listedFieldsForClientType(
  clientType: string,
): ConfigurableField[] {
  return [
    'document',
    'phone',
    'email',
    'birthDate',
    ...locationFieldsForClientType(clientType),
  ];
}

export function defaultConfigForClientType(
  clientType: string,
): ResolvedRegistrationFieldsConfig {
  const location = new Set(locationFieldsForClientType(clientType));
  return {
    document: 'required',
    phone: 'required',
    email: 'required',
    birthDate: 'hidden',
    block: location.has('block') ? 'required' : 'hidden',
    unit: location.has('unit') ? 'required' : 'hidden',
    room: location.has('room') ? 'required' : 'hidden',
  };
}

function isFieldRule(value: unknown): value is FieldRule {
  return value === 'required' || value === 'optional' || value === 'hidden';
}

export function resolveRegistrationFieldsConfig(
  clientType: string,
  stored: unknown,
): ResolvedRegistrationFieldsConfig {
  const resolved = { ...defaultConfigForClientType(clientType) };
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return resolved;
  }
  const record = stored as Record<string, unknown>;
  for (const field of CONFIGURABLE_FIELDS) {
    const value = record[field];
    if (isFieldRule(value)) {
      resolved[field] = value;
    }
  }
  return resolved;
}

export function applyRestrictMinorsFieldRules(
  fields: ResolvedRegistrationFieldsConfig,
  hasRestrictMinorsReader: boolean,
): ResolvedRegistrationFieldsConfig {
  if (!hasRestrictMinorsReader || fields.birthDate === 'required') {
    return fields;
  }
  return { ...fields, birthDate: 'required' };
}

export const BIRTH_DATE_REQUIRED_WITH_18_PLUS =
  'Data de nascimento é obrigatória enquanto houver leitor 18+.';

export function overrideFromResolved(
  clientType: string,
  resolved: ResolvedRegistrationFieldsConfig,
): Record<string, FieldRule> | null {
  const defaults = defaultConfigForClientType(clientType);
  const override: Record<string, FieldRule> = {};
  for (const field of CONFIGURABLE_FIELDS) {
    if (resolved[field] !== defaults[field]) {
      override[field] = resolved[field];
    }
  }
  return Object.keys(override).length > 0 ? override : null;
}
