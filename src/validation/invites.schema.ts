import { z } from 'zod';

export const generateInviteSchema = z.object({
  companyId: z.string().uuid('Empresa inválida'),
  role: z.enum(['company_admin', 'company_operator']),
});
