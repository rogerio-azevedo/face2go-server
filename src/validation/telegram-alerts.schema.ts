import { z } from 'zod';

export const createTelegramLinkTokenSchema = z
  .object({
    kind: z.enum(['user', 'group']),
    targetUserId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'user' && !value.targetUserId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Usuário obrigatório.',
        path: ['targetUserId'],
      });
    }
  });

export const updateTelegramChatSchema = z.object({
  isActive: z.boolean(),
});

export const telegramWebhookSchema = z.object({
  update_id: z.number().optional(),
  message: z.unknown().optional(),
  my_chat_member: z.unknown().optional(),
});
