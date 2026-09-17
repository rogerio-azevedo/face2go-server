import { z } from 'zod';

export const generateInviteBodySchema = z.object({
  role: z.enum(['company_admin', 'company_operator']),
});

export const generateInviteSchema = generateInviteBodySchema.extend({
  companyId: z.string().uuid('Empresa inválida'),
});
