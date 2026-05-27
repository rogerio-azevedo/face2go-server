import { z } from 'zod';

export const generateClientInviteSchema = z.object({
  clientId: z.string().uuid('Cliente inválido'),
  role: z.enum(['client_admin', 'client_operator']),
});

export const generateCompanyInviteByAdminSchema = z.object({
  role: z.enum(['company_admin', 'company_operator']),
});
