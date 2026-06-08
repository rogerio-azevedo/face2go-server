import { z } from 'zod';

import { normalizeVehiclePlate } from './vehicles.schema';

import { normalizeCpf } from '../auth/utils/auth-identifiers';

export type StoredPickupAuthorizationStatus =
  | 'active'
  | 'used'
  | 'expired'
  | 'cancelled';

export function computeEffectivePickupStatus(row: {
  status: StoredPickupAuthorizationStatus;
  validUntil: Date;
}): StoredPickupAuthorizationStatus {
  if (row.status !== 'active') return row.status;
  if (Date.now() > row.validUntil.getTime()) return 'expired';
  return 'active';
}

const BR_PLATE_RE = /^([A-Z]{3}[0-9]{4}|[A-Z]{3}[0-9][A-Z][0-9]{2})$/;

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
    guestName: z.string().trim().min(1).max(255),
    guestDocument: z.string().trim().min(1).max(64),
    guestPhone: z.string().trim().max(32).nullable().optional(),
    validFrom: z.coerce.date(),
    validUntil: z.coerce.date(),
    notes: z.string().trim().max(2000).nullable().optional(),
    vehicle: pickupVehicleSchema.optional(),
    linkedResponsibleId: z.uuid().optional(),
  })
  .transform((d) => ({
    studentIds: [...new Set(d.studentIds)],
    guestName: d.guestName.trim(),
    guestDocument: normalizeCpf(d.guestDocument.trim()) || d.guestDocument.trim(),
    guestPhone: d.guestPhone?.trim() ? d.guestPhone.trim() : null,
    validFrom: d.validFrom,
    validUntil: d.validUntil,
    notes: d.notes?.trim() ? d.notes.trim() : null,
    vehicle: d.vehicle ?? null,
    linkedResponsibleId: d.linkedResponsibleId ?? null,
  }))
  .refine((data) => data.validUntil.getTime() > data.validFrom.getTime(), {
    message: 'validUntil deve ser posterior a validFrom.',
    path: ['validUntil'],
  });

export const updatePickupAuthorizationSchema = z
  .object({
    studentIds: z.array(z.uuid()).min(1).optional(),
    guestName: z.string().trim().min(1).max(255).optional(),
    guestDocument: z.string().trim().min(1).max(64).optional(),
    guestPhone: z.string().trim().max(32).nullable().optional(),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().optional(),
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
