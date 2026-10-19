import { z } from 'zod';
import { isValidCpf, normalizeCpf } from '../common/utils/document';

export const visitorApprovalCpfSchema = z.object({
  cpf: z
    .string()
    .max(32)
    .refine(isValidCpf, 'Informe um CPF válido.')
    .transform(normalizeCpf),
});
export const acceptVisitorApprovalSchema = visitorApprovalCpfSchema.extend({
  agreed: z.literal(true, {
    error: 'Confirme que leu e concorda com o termo.',
  }),
  termVersion: z.string().min(1).max(80),
});
export const revokeVisitorApprovalSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export const visitorApprovalSummarySchema = z.object({
  visitorApprovalPendingReason: z
    .enum(['no_eligible_adult', 'awaiting_consent'])
    .nullable(),
  isVisitor: z.boolean(),
  enableVisitorApprove: z.boolean(),
  visitorApprovalRequired: z.boolean(),
  visitorApprovalStatus: z.enum(['not_applicable', 'pending', 'authorized']),
  visitorApprovalValidCount: z.number().int(),
  visitorApprovalRequested: z.boolean(),
  visitorApprovalRemovalPending: z.boolean(),
});
export const visitorApprovalPreviewSchema = z.object({
  clientName: z.string(),
  visitorName: z.string(),
  hasPhoto: z.boolean(),
  adultName: z.string(),
  block: z.string().nullable(),
  unit: z.string().nullable(),
  termVersion: z.string(),
  termContent: z.string(),
  accepted: z.boolean(),
  revoked: z.boolean(),
  canAccept: z.boolean(),
});
const snapshot = z.object({
  name: z.string(),
  registrationId: z.string().uuid(),
  birthDate: z.string().nullable(),
  block: z.string().nullable(),
  unit: z.string().nullable(),
});
export const visitorApprovalHistorySchema = z.object({
  summary: visitorApprovalSummarySchema,
  consents: z.array(
    z.object({
      id: z.string().uuid(),
      adultSnapshot: snapshot,
      visitorSnapshot: snapshot,
      termVersion: z.string(),
      termContent: z.string(),
      termHash: z.string(),
      acceptedAt: z.string(),
      revokedAt: z.string().nullable(),
      revokedBy: z.string().nullable(),
      revocationReason: z.string().nullable(),
    }),
  ),
  requests: z.array(
    z.object({
      id: z.string().uuid(),
      adultName: z.string(),
      emailSentAt: z.string().nullable(),
      emailError: z.string().nullable(),
      expiresAt: z.string(),
      accepted: z.boolean(),
      canceled: z.boolean(),
    }),
  ),
});
export const visitorApprovalResultSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});
