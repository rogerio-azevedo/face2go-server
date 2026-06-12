import { z } from 'zod';

import { normalizeVehiclePlate } from './vehicles.schema';
import { parseWallClockDate } from './pickup-authorizations.schema';

import { normalizeCpf } from '../auth/utils/auth-identifiers';

export type StoredVisitorInviteStatus =
  | 'active'
  | 'used'
  | 'expired'
  | 'cancelled';

export function computeEffectiveVisitorInviteStatus(row: {
  status: StoredVisitorInviteStatus;
  validUntil: Date;
}): StoredVisitorInviteStatus {
  if (row.status !== 'active') return row.status;
  if (Date.now() > row.validUntil.getTime()) return 'expired';
  return 'active';
}

const BR_PLATE_RE = /^([A-Z]{3}[0-9]{4}|[A-Z]{3}[0-9][A-Z][0-9]{2})$/;

const optionalValidDate = z.preprocess(
  (val) => parseWallClockDate(val),
  z.date().optional(),
);

const inviteVehicleSchema = z
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

export const createVisitorInviteSchema = z
  .object({
    guestName: z.string().trim().min(1).max(255).optional(),
    guestDocument: z.string().trim().min(1).max(64).optional(),
    guestPhone: z.string().trim().max(32).nullable().optional(),
    validFrom: optionalValidDate,
    validUntil: optionalValidDate,
    notes: z.string().trim().max(2000).nullable().optional(),
    vehicle: inviteVehicleSchema.optional(),
  })
  .transform((d) => {
    const now = new Date();
    const validFrom = d.validFrom ?? now;
    const validUntil =
      d.validUntil ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);

    return {
      guestName: d.guestName?.trim() ? d.guestName.trim() : null,
      guestDocument: d.guestDocument?.trim()
        ? normalizeCpf(d.guestDocument.trim()) || d.guestDocument.trim()
        : null,
      guestPhone: d.guestPhone?.trim() ? d.guestPhone.trim() : null,
      validFrom,
      validUntil,
      notes: d.notes?.trim() ? d.notes.trim() : null,
      vehicle: d.vehicle ?? null,
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

    const hasName = Boolean(data.guestName);
    const hasDoc = Boolean(data.guestDocument);
    if (hasName !== hasDoc) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Informe nome e documento do visitante, ou omita ambos para cadastro por link.',
        path: ['guestName'],
      });
    }
  });

export const updateVisitorInviteSchema = z
  .object({
    guestName: z.string().trim().min(1).max(255).optional(),
    guestDocument: z.string().trim().min(1).max(64).optional(),
    guestPhone: z.string().trim().max(32).nullable().optional(),
    validFrom: z.preprocess((val) => parseWallClockDate(val), z.date().optional()),
    validUntil: z.preprocess((val) => parseWallClockDate(val), z.date().optional()),
    notes: z.string().trim().max(2000).nullable().optional(),
    vehicle: inviteVehicleSchema.nullable().optional(),
  })
  .transform((d) => ({
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
