import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const uploadFaceSchema = z.object({
  imageBase64: z
    .string()
    .min(64, 'Imagem inválida')
    .describe(
      'Imagem JPEG em base64 (opcional prefixo data:image/jpeg;base64,)',
    ),
});

const updatePushTokenSchema = z.object({
  pushToken: z.string().min(1).max(512),
});

const simulateFaceAccessSchema = z.object({
  clientId: z.uuid('ID do cliente inválido'),
  personId: z.uuid('ID da pessoa inválido'),
  personType: z.enum(['student', 'responsible', 'member']),
  readerId: z.uuid('ID do leitor inválido').optional(),
});

export class UploadFaceDto extends createZodDto(uploadFaceSchema) {}
export class UpdatePushTokenDto extends createZodDto(updatePushTokenSchema) {}
export class SimulateFaceAccessDto extends createZodDto(
  simulateFaceAccessSchema,
) {}
