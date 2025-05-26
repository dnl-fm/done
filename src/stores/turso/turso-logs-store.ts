import { z } from 'zod';
import { Client } from 'libsql-core';
import { LogsStoreInterface } from '../../interfaces/logs-store-interface.ts';
import { LogMessageDataSchema, LogMessageModelSchema } from '../../schemas/log-schema.ts';
import { Security } from '../../utils/security.ts';

export const LOGS_STORE_NAME = 'logs';
export const LOGS_MODEL_ID_PREFIX = 'log';

export class TursoLogsStore implements LogsStoreInterface {
  constructor(private sqlite: Client) {}

  getStoreName(): string {
    return LOGS_STORE_NAME;
  }

  getModelIdPrefix(): string {
    return LOGS_MODEL_ID_PREFIX;
  }

  buildModelId(): string {
    return Security.generateId();
  }

  buildModelIdWithPrefix(): string {
    return `${this.getModelIdPrefix()}_${this.buildModelId()}`;
  }

  async create(
    data: z.infer<typeof LogMessageDataSchema>,
    options?: { withId: string },
  ): Promise<z.infer<typeof LogMessageModelSchema>> {
    const id = options?.withId || this.buildModelIdWithPrefix();
    const now = new Date();

    await this.sqlite.execute({
      sql: `INSERT INTO logs (id, type, object, message_id, before_data, after_data, created_at)
            VALUES (:id, :type, :object, :message_id, :before_data, :after_data, :created_at)`,
      args: {
        id,
        type: data.type,
        object: data.object,
        message_id: data.message_id,
        before_data: JSON.stringify(data.before_data),
        after_data: JSON.stringify(data.after_data),
        created_at: now.toISOString(),
      },
    });

    return {
      id,
      type: data.type,
      object: data.object,
      message_id: data.message_id,
      before_data: data.before_data,
      after_data: data.after_data,
      created_at: now,
    };
  }

  async fetchByMessageId(messageId: string): Promise<z.infer<typeof LogMessageModelSchema>[]> {
    const result = await this.sqlite.execute({
      sql: `SELECT id, type, object, message_id, before_data, after_data, created_at
            FROM logs
            WHERE message_id = :message_id
            ORDER BY created_at ASC`,
      args: { message_id: messageId },
    });

    return result.rows.map((row) => ({
      id: row.id as string,
      type: row.type as string,
      object: row.object as string,
      message_id: row.message_id as string,
      before_data: JSON.parse(row.before_data as string),
      after_data: JSON.parse(row.after_data as string),
      created_at: new Date(row.created_at as string),
    }));
  }

  async fetchAll(limit = 100): Promise<z.infer<typeof LogMessageModelSchema>[]> {
    const result = await this.sqlite.execute({
      sql: `SELECT id, type, object, message_id, before_data, after_data, created_at
            FROM logs
            ORDER BY created_at DESC
            LIMIT :limit`,
      args: { limit },
    });

    return result.rows.map((row) => ({
      id: row.id as string,
      type: row.type as string,
      object: row.object as string,
      message_id: row.message_id as string,
      before_data: JSON.parse(row.before_data as string),
      after_data: JSON.parse(row.after_data as string),
      created_at: new Date(row.created_at as string),
    }));
  }

  async reset(): Promise<void> {
    await this.sqlite.execute('DELETE FROM logs');
  }
}
