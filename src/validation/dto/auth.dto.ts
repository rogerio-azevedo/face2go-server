import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { joinContextSchema } from '../join-context.schema';
import { registerSchema } from '../register.schema';
import { requestPasswordSchema } from '../request-password.schema';
import { resetPasswordSchema } from '../reset-password.schema';

const loginSchema = z
  .object({
    /** Compatível com clientes antigos (ex.: app mobile) que ainda enviam `email`. */
    email: z.string().email('E-mail inválido').optional(),
    identifier: z.string().min(1).optional(),
    password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
  })
  .refine((data) => Boolean(data.identifier?.trim() || data.email?.trim()), {
    message: 'Informe e-mail ou CPF.',
  });

const selectContextSchema = z.object({
  contextType: z.enum([
    'super_admin',
    'company',
    'client',
    'responsible',
    'member',
    'face_user',
  ]),
  contextId: z.string().optional(),
});

export class LoginDto extends createZodDto(loginSchema) {}
export class SelectContextDto extends createZodDto(selectContextSchema) {}
export class RegisterDto extends createZodDto(registerSchema) {}
export class JoinContextDto extends createZodDto(joinContextSchema) {}
export class RequestPasswordDto extends createZodDto(requestPasswordSchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
