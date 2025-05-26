import z from 'zod';
import { LogMessageDataSchema, LogMessageModelSchema } from '../schemas/log-schema.ts';

export interface LogsStoreInterface {
  getStoreName(): string;
  getModelIdPrefix(): string;
  buildModelId(): string;
  buildModelIdWithPrefix(): string;
  create(data: z.infer<typeof LogMessageDataSchema>, options?: { withId: string }): Promise<z.infer<typeof LogMessageModelSchema>>;
}
