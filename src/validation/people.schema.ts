import { z } from 'zod';

import { normalizeCpf } from '../auth/utils/auth-identifiers';

export const personLookupQuerySchema = z
  .object({
    cpf: z.string().trim().max(14).optional(),
    email: z.email('E-mail inválido.').optional(),
  })
  .superRefine((data, ctx) => {
    const cpf = data.cpf ? normalizeCpf(data.cpf) : '';
    const email = data.email?.trim();
    if (cpf.length !== 11 && !email) {
      ctx.addIssue({
        code: 'custom',
        message: 'Informe CPF ou e-mail para buscar.',
      });
    }
  });

export type PersonLookupQuery = z.infer<typeof personLookupQuerySchema>;

export type PersonContextType = 'member' | 'responsible';

export type PersonLookupContext = {
  type: PersonContextType;
  clientId: string;
  clientName: string;
  isActive: boolean;
  hasLogin: boolean;
};

export type PersonLookupProfile = {
  name: string;
  email: string | null;
  phone: string | null;
};

export type PersonLookupResult = {
  matched: boolean;
  userId: string | null;
  hasLogin: boolean;
  profile: PersonLookupProfile | null;
  contexts: PersonLookupContext[];
  conflict?: string;
};
