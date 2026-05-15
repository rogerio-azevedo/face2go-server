import { z } from 'zod';

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

export const createPickupAuthorizationSchema = z
  .object({
    studentId: z.uuid(),
    authorizedResponsibleId: z.uuid().nullable().optional(),
    guestName: z.string().trim().min(1).max(255).nullable().optional(),
    guestDocument: z.string().trim().min(1).max(64).nullable().optional(),
    guestPhone: z.string().trim().max(32).nullable().optional(),
    validFrom: z.coerce.date(),
    validUntil: z.coerce.date(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .transform((d) => ({
    studentId: d.studentId,
    authorizedResponsibleId: d.authorizedResponsibleId ?? null,
    guestName: d.guestName?.trim() ? d.guestName.trim() : null,
    guestDocument: d.guestDocument?.trim() ? d.guestDocument.trim() : null,
    guestPhone: d.guestPhone?.trim() ? d.guestPhone.trim() : null,
    validFrom: d.validFrom,
    validUntil: d.validUntil,
    notes: d.notes?.trim() ? d.notes.trim() : null,
  }))
  .refine((data) => data.validUntil.getTime() > data.validFrom.getTime(), {
    message: 'validUntil deve ser posterior a validFrom.',
    path: ['validUntil'],
  })
  .refine(
    (data) => {
      const hasAuthorized = !!data.authorizedResponsibleId;
      const hasGuest = !!data.guestName && !!data.guestDocument;
      return hasAuthorized !== hasGuest;
    },
    {
      message:
        'Informe authorizedResponsibleId (responsável cadastrado na escola) ou nome e documento do convidado — um dos dois.',
    },
  );
