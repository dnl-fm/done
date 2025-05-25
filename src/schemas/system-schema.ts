import { z } from 'zod';

export const HasDatesSchema = z.object({
  created_at: z.date(),
  updated_at: z.date(),
});

export const ModelSchema = HasDatesSchema.extend({
  id: z.string(),
});

export const SystemMessageTypeSchema = z.union([
  z.literal('STORE_CREATE_EVENT'),
  z.literal('STORE_UPDATE_EVENT'),
  z.literal('STORE_DELETE_EVENT'),
  z.literal('MESSAGE_RECEIVED'),
  z.literal('MESSAGE_QUEUED'),
  z.literal('MESSAGE_RETRY'),
]);

export const SystemMessageStatusSchema = z.union([
  z.literal('CREATED'),
  z.literal('RECEIVED'),
  z.literal('PROCESSED'),
  z.literal('IGNORE'),
]);

export const SystemMessageSchema = z.object({
  id: z.string(),
  type: SystemMessageTypeSchema,
  data: z.unknown(),
  object: z.string(),
  created_at: z.date(),
});

export const SecondaryTypeSchema = z.union([
  z.literal('ONE'),
  z.literal('MANY'),
]);

export const SecondarySchema = z.object({
  type: SecondaryTypeSchema,
  key: z.array(z.string()),
  value: z.string().or(z.array(z.string())).optional(),
});
