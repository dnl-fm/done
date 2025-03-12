import { Client, Row } from 'libsql-core';
import { err, ok, Result } from 'result';
import { Dates } from '../utils/dates.ts';
import { Security } from '../utils/security.ts';
import { MESSAGE_STATUS, MessageData, MessageModel } from './kv-message-model.ts';
import { MessagesStoreInterface } from './messages-store-interface.ts';

export class TursoMessagesStore implements MessagesStoreInterface {
  constructor(private sqlite: Client) {}

  getStoreName(): string {
    return 'messages';
  }

  getModelIdPrefix(): string {
    return 'msg';
  }

  buildModelId(): string {
    return Security.generateId();
  }

  buildModelIdWithPrefix(): string {
    return `${this.getModelIdPrefix().toLowerCase()}_${this.buildModelId()}`;
  }

  async create(
    data: MessageData,
    options?: { withId?: string },
  ): Promise<Result<MessageModel, string>> {
    try {
      const now = new Date();
      const id = options?.withId || this.buildModelIdWithPrefix();
      const message: MessageModel = {
        id,
        ...data,
        created_at: now,
        updated_at: now,
      };

      const result = await this.sqlite.execute({
        sql: `INSERT INTO messages (
          id, payload, publish_at, delivered_at, retry_at, retried, status, last_errors, created_at, updated_at
        ) VALUES (:id, :payload, :publish_at, :delivered_at, :retry_at, :retried, :status, :last_errors, :created_at, :updated_at)`,
        args: {
          id: message.id,
          payload: JSON.stringify(message.payload),
          publish_at: message.publish_at.toISOString(),
          delivered_at: message.delivered_at?.toISOString() || null,
          retry_at: message.retry_at?.toISOString() || null,
          retried: message.retried || 0,
          status: message.status,
          last_errors: message.last_errors ? JSON.stringify(message.last_errors) : null,
          created_at: message.created_at.toISOString(),
          updated_at: message.updated_at.toISOString(),
        },
      });

      if (result.rowsAffected === 1) {
        return ok(message);
      }

      return err('Failed to create message');
    } catch (error: unknown) {
      return err(`Database error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async fetch(id: string): Promise<Result<MessageModel, string>> {
    try {
      const result = await this.sqlite.execute({
        sql: 'SELECT * FROM messages WHERE id = :id',
        args: { id },
      });

      if (result.rows.length === 0) {
        return err('Unknown message');
      }

      return ok(this.rowToModel(result.rows[0]));
    } catch (error: unknown) {
      return err(`Database error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async fetchByStatus(status: MESSAGE_STATUS): Promise<Result<MessageModel[], string>> {
    try {
      const result = await this.sqlite.execute({
        sql: 'SELECT * FROM messages WHERE status = :status ORDER BY created_at DESC',
        args: { status },
      });

      return ok(result.rows.map((row) => this.rowToModel(row)));
    } catch (error: unknown) {
      return err(`Database error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async fetchByDate(date: Date): Promise<Result<MessageModel[], string>> {
    try {
      const dateOnly = Dates.getDateOnly(date);
      const result = await this.sqlite.execute({
        sql: 'SELECT * FROM messages WHERE date(publish_at) = date(:date) ORDER BY publish_at ASC',
        args: { date: dateOnly },
      });

      return ok(result.rows.map((row) => this.rowToModel(row)));
    } catch (error: unknown) {
      return err(`Database error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async update(id: string, data: Partial<MessageData & { updated_at?: Date }>): Promise<Result<MessageModel, string>> {
    try {
      const setClauses: string[] = [];
      const args: Record<string, string | number | null> = { id };

      // Build dynamic SET clause
      if (data.payload) {
        setClauses.push('payload = :payload');
        args.payload = JSON.stringify(data.payload);
      }
      if (data.publish_at) {
        setClauses.push('publish_at = :publish_at');
        args.publish_at = data.publish_at.toISOString();
      }
      if (data.delivered_at) {
        setClauses.push('delivered_at = :delivered_at');
        args.delivered_at = data.delivered_at.toISOString();
      }
      if (data.retry_at) {
        setClauses.push('retry_at = :retry_at');
        args.retry_at = data.retry_at.toISOString();
      }
      if (typeof data.retried === 'number') {
        setClauses.push('retried = :retried');
        args.retried = data.retried;
      }
      if (data.status) {
        setClauses.push('status = :status');
        args.status = data.status;
      }
      if (data.last_errors) {
        setClauses.push('last_errors = :last_errors');
        args.last_errors = JSON.stringify(data.last_errors);
      }

      // Add updated_at
      setClauses.push('updated_at = :updated_at');
      args.updated_at = (data.updated_at || new Date()).toISOString();

      const result = await this.sqlite.execute({
        sql: `UPDATE messages SET ${setClauses.join(', ')} WHERE id = :id`,
        args,
      });

      if (result.rowsAffected === 0) {
        return err('Message not found');
      }

      return this.fetch(id);
    } catch (error: unknown) {
      return err(`Database error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async delete(id: string): Promise<Result<boolean, string>> {
    try {
      const result = await this.sqlite.execute({
        sql: 'DELETE FROM messages WHERE id = :id',
        args: { id },
      });

      return ok(result.rowsAffected > 0);
    } catch (error: unknown) {
      return err(`Database error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private rowToModel(row: Row): MessageModel {
    return {
      id: row[0] as string,
      payload: JSON.parse(row[1] as string),
      publish_at: new Date(row[2] as string),
      delivered_at: row[3] ? new Date(row[3] as string) : undefined,
      retry_at: row[4] ? new Date(row[4] as string) : undefined,
      retried: row[5] as number,
      status: row[6] as MESSAGE_STATUS,
      last_errors: row[7] ? JSON.parse(row[7] as string) : undefined,
      created_at: new Date(row[8] as string),
      updated_at: new Date(row[9] as string),
    };
  }
}
