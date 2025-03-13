import { z } from 'zod';

export const MessageHeadersSchema = z.object({
  command: z.record(z.string(), z.string()),
  forward: z.record(z.string(), z.string()),
});

export const MessagePayloadSchema = z.object({
  headers: MessageHeadersSchema,
  url: z.string(),
  data: z.object({}).optional(),
});

export const MessageReceivedDataSchema = z.object({
  id: z.string().regex(/^msg_/),
  publish_at: z.date(),
  payload: MessagePayloadSchema,
});

export const MessageStatusSchema = z.enum(['CREATED', 'QUEUED', 'DELIVER', 'SENT', 'RETRY', 'DLQ', 'ARCHIVED']);

export const MessageSchema = z.object({
  id: z.string().regex(/^msg_/),
  payload: MessagePayloadSchema,
  status: MessageStatusSchema,
  publish_at: z.date(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const MessageReceivedResponseSchema = z.object({
  id: z.string(),
  publish_at: z.string().datetime(),
});
