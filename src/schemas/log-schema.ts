import { z } from 'zod';

export const LogMessageDataSchema = z.object({
  id: z.string().regex(/^log_/).optional(),
  type: z.string(),
  object: z.string(),
  message_id: z.string(),
  before_data: z.record(z.any()),
  after_data: z.record(z.any()),
  created_at: z.date(),
});

export const LogMessageModelSchema = LogMessageDataSchema.extend({
  id: z.string().regex(/^log_/),
});
