import { z } from 'zod';

export const LogMessageDataSchema = z.object({
  id: z.string().regex(/^log_/).optional(),
  type: z.string(),
  object: z.string(),
  message_id: z.string(),
  before_data: z.record(z.any()).nullable(),
  after_data: z.record(z.any()).nullable(),
});

export const LogMessageModelSchema = LogMessageDataSchema.extend({
  id: z.string().regex(/^log_/),
  created_at: z.date(),
});
