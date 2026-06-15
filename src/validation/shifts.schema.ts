import { z } from 'zod';

const HH_MM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOfDay(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export const shiftWeekdayKeys = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type ShiftWeekdayKey = (typeof shiftWeekdayKeys)[number];

const timeWindowSchema = z
  .object({
    start: z
      .string()
      .trim()
      .regex(HH_MM_REGEX, 'Use horários no formato HH:MM (24h).'),
    end: z
      .string()
      .trim()
      .regex(HH_MM_REGEX, 'Use horários no formato HH:MM (24h).'),
  })
  .superRefine((win, ctx) => {
    if (minutesOfDay(win.start) >= minutesOfDay(win.end)) {
      ctx.addIssue({
        code: 'custom',
        message: 'O horário inicial deve ser menor que o final.',
        path: ['end'],
      });
    }
  });

const shiftScheduleSchema = z
  .object({
    sunday: z.array(timeWindowSchema).max(4).optional(),
    monday: z.array(timeWindowSchema).max(4).optional(),
    tuesday: z.array(timeWindowSchema).max(4).optional(),
    wednesday: z.array(timeWindowSchema).max(4).optional(),
    thursday: z.array(timeWindowSchema).max(4).optional(),
    friday: z.array(timeWindowSchema).max(4).optional(),
    saturday: z.array(timeWindowSchema).max(4).optional(),
  })
  .strict();

export const createShiftSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do horário.').max(255),
  schedule: shiftScheduleSchema.default({}),
  isActive: z.boolean().optional().default(true),
});

export const updateShiftSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  schedule: shiftScheduleSchema.optional(),
  isActive: z.boolean().optional(),
});
