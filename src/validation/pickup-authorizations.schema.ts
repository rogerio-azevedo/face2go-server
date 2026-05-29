import { z } from 'zod';

import { normalizeVehiclePlate } from './vehicles.schema';

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
  })
  .transform((d) => ({
    studentIds: [...new Set(d.studentIds)],
    guestName: d.guestName.trim(),
    guestDocument: d.guestDocument.trim(),
    guestPhone: d.guestPhone?.trim() ? d.guestPhone.trim() : null,
    validFrom: d.validFrom,
    validUntil: d.validUntil,
    notes: d.notes?.trim() ? d.notes.trim() : null,
    vehicle: d.vehicle ?? null,
  }))
  .refine((data) => data.validUntil.getTime() > data.validFrom.getTime(), {
    message: 'validUntil deve ser posterior a validFrom.',
    path: ['validUntil'],
  });
