import { z } from 'zod';

import { normalizeVehiclePlate } from './vehicles.schema';

import { normalizeCpf } from '../auth/utils/auth-identifiers';

export type StoredPickupAuthorizationStatus =
  'active' | 'used' | 'expired' | 'cancelled';

export function computeEffectivePickupStatus(row: {
  status: StoredPickupAuthorizationStatus;
  validUntil: Date;
}): StoredPickupAuthorizationStatus {
  if (row.status !== 'active') return row.status;
  if (Date.now() > row.validUntil.getTime()) return 'expired';
  return 'active';
}

const BR_PLATE_RE = /^([A-Z]{3}[0-9]{4}|[A-Z]{3}[0-9][A-Z][0-9]{2})$/;

/**
 * Interpreta datetime como relógio de parede (sem fuso) — o mesmo valor enviado ao leitor.
 * ISO com Z/offset continua aceito por compatibilidade com registros antigos.
 */
export function parseWallClockDate(val: unknown): Date | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const raw =
    typeof val === 'string'
      ? val.trim()
      : typeof val === 'number' || typeof val === 'boolean'
        ? String(val).trim()
        : '';
  if (!raw) return undefined;
  if (/[zZ]$/.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(
    raw,
  );
  if (m) {
    return new Date(
      Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)),
    );
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const optionalValidDate = z.preprocess(
  (val) => parseWallClockDate(val),
  z.date().optional(),
);

const pickupVehicleSchema = z
  .object({
    plate: z.string(),
    brand: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(100),
    color: z.string().trim().min(1).max(50),
  })
  .transform((d) => ({
    plate: normalizeVehiclePlate(d.plate),
    brand: d.brand.trim(),
    model: d.model.trim(),
    color: d.color.trim(),
  }))
  .superRefine((d, ctx) => {
    if (!BR_PLATE_RE.test(d.plate)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Placa inválida. Use o formato antigo (ABC1234) ou Mercosul (ABC1D23).',
        path: ['plate'],
      });
    }
  });

export const createPickupAuthorizationSchema = z
  .object({
    studentIds: z.array(z.uuid()).min(1, 'Selecione ao menos um aluno.'),
    guestName: z.string().trim().min(1).max(255).optional(),
    guestDocument: z.string().trim().min(1).max(64).optional(),
    guestPhone: z.string().trim().max(32).nullable().optional(),
    validFrom: optionalValidDate,
    validUntil: optionalValidDate,
    notes: z.string().trim().max(2000).nullable().optional(),
    vehicle: pickupVehicleSchema.optional(),
    linkedResponsibleId: z.uuid().optional(),
  })
  .transform((d) => {
    const now = new Date();
    const validFrom = d.validFrom ?? now;
    const validUntil =
      d.validUntil ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);

    return {
      studentIds: [...new Set(d.studentIds)],
      guestName: d.guestName?.trim() ? d.guestName.trim() : null,
      guestDocument: d.guestDocument?.trim()
        ? normalizeCpf(d.guestDocument.trim()) || d.guestDocument.trim()
        : null,
      guestPhone: d.guestPhone?.trim() ? d.guestPhone.trim() : null,
      validFrom,
      validUntil,
      notes: d.notes?.trim() ? d.notes.trim() : null,
      vehicle: d.vehicle ?? null,
      linkedResponsibleId: d.linkedResponsibleId ?? null,
    };
  })
  .superRefine((data, ctx) => {
    if (data.validUntil.getTime() <= data.validFrom.getTime()) {
      ctx.addIssue({
        code: 'custom',
        message: 'validUntil deve ser posterior a validFrom.',
        path: ['validUntil'],
      });
    }

    if (data.linkedResponsibleId) return;

    const hasName = Boolean(data.guestName);
    const hasDoc = Boolean(data.guestDocument);
    if (hasName !== hasDoc) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Informe nome e documento do convidado, ou omita ambos para cadastro por link.',
        path: ['guestName'],
      });
    }
  });

export const updatePickupAuthorizationSchema = z
  .object({
    studentIds: z.array(z.uuid()).min(1).optional(),
    guestName: z.string().trim().min(1).max(255).optional(),
    guestDocument: z.string().trim().min(1).max(64).optional(),
    guestPhone: z.string().trim().max(32).nullable().optional(),
    validFrom: z.preprocess(
      (val) => parseWallClockDate(val),
      z.date().optional(),
    ),
    validUntil: z.preprocess(
      (val) => parseWallClockDate(val),
      z.date().optional(),
    ),
    notes: z.string().trim().max(2000).nullable().optional(),
    vehicle: pickupVehicleSchema.nullable().optional(),
    linkedResponsibleId: z.uuid().nullable().optional(),
  })
  .transform((d) => ({
    studentIds: d.studentIds ? [...new Set(d.studentIds)] : undefined,
    guestName: d.guestName?.trim(),
    guestDocument: d.guestDocument
      ? normalizeCpf(d.guestDocument.trim()) || d.guestDocument.trim()
      : undefined,
    guestPhone:
      d.guestPhone === undefined
        ? undefined
        : d.guestPhone?.trim()
          ? d.guestPhone.trim()
          : null,
    validFrom: d.validFrom,
    validUntil: d.validUntil,
    notes:
      d.notes === undefined
        ? undefined
        : d.notes?.trim()
          ? d.notes.trim()
          : null,
    vehicle: d.vehicle === undefined ? undefined : d.vehicle,
    linkedResponsibleId: d.linkedResponsibleId,
  }))
  .superRefine((data, ctx) => {
    if (
      data.validFrom &&
      data.validUntil &&
      data.validUntil.getTime() <= data.validFrom.getTime()
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'validUntil deve ser posterior a validFrom.',
        path: ['validUntil'],
      });
    }
  });

const optionalPickupVehicleSchema = pickupVehicleSchema.optional();

function mapLegacyPickupRegisterSubmitBody(val: unknown): unknown {
  if (!val || typeof val !== 'object') return val;
  const body = val as Record<string, unknown>;
  return {
    ...body,
    name: body.name ?? body.guestName,
    document: body.document ?? body.guestDocument,
    phone: body.phone ?? body.guestPhone,
  };
}

export const publicPickupRegisterSubmitSchema = z.preprocess(
  mapLegacyPickupRegisterSubmitBody,
  z.object({
    name: z.string().trim().min(1).max(255).optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    faceImageKey: z.string().min(1),
    vehicle: optionalPickupVehicleSchema,
    document: z
      .string()
      .trim()
      .optional()
      .transform((value) =>
        value?.trim() ? normalizeCpf(value.trim()) : undefined,
      )
      .refine((value) => value === undefined || value.length === 11, {
        message: 'CPF inválido.',
      }),
  }),
);

export type PublicPickupRegisterSubmitInput = z.infer<
  typeof publicPickupRegisterSubmitSchema
>;
