import { Client, Row } from 'libsql-core';
import { err, ok, Result } from 'result';
import { MessagesStoreInterface } from '../../interfaces/messages-store-interface.ts';
import { LogsStoreInterface } from '../../interfaces/logs-store-interface.ts';
import { StatsService } from '../../services/stats-service.ts';
import { Dates } from '../../utils/dates.ts';
import { Security } from '../../utils/security.ts';
import { MESSAGE_STATUS, MessageData, MessageModel, MessageReceivedData } from '../kv/kv-message-model.ts';
import { Env } from '../../utils/env.ts';

export class TursoMessagesStore implements MessagesStoreInterface {
  private statsService: StatsService;
  private kv?: Deno.Kv;

  constructor(
    private sqlite: Client,
    private logsStore?: LogsStoreInterface,
    kv?: Deno.Kv,
  ) {
    this.statsService = new StatsService({ sqlite });
    this.kv = kv;
  }

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

  async createFromReceivedData(data: MessageReceivedData) {
    return await this.create({ payload: data.payload, publish_at: data.publish_at, status: 'CREATED' }, { withId: data.id });
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
        // Update stats when message is created
        await this.statsService.incrementStatus(message.status, message.publish_at);

        // Create log if enabled
        if (this.logsStore && Env.get('ENABLE_LOGS') === 'true') {
          await this.logsStore.create({
            type: 'STORE_CREATE_EVENT',
            object: this.getStoreName(),
            message_id: message.id,
            before_data: null,
            after_data: message,
          });
        }

        // Enqueue message for state processing (to match KV behavior)
        if (this.kv) {
          const systemMessage = {
            type: 'STORE_CREATE_EVENT',
            object: this.getStoreName(),
            data: { after: message },
            id: `log_${Security.generateId()}`,
            created_at: new Date(),
          };
          console.log(`[${new Date().toISOString()}] Turso enqueuing STORE_CREATE_EVENT for new message ${message.id}`);
          await this.kv.enqueue(systemMessage);
        } else {
          console.warn(`[${new Date().toISOString()}] Turso store has no KV instance, cannot enqueue create event for message ${message.id}`);
        }

        return ok(message);
      }

      return err('Failed to create message');
    } catch (error: unknown) {
      return err(`Database error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async fetchOne(id: string): Promise<Result<MessageModel, string>> {
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
    console.log(`[${new Date().toISOString()}] TursoMessagesStore.update called for ${id} with data:`, data);
    try {
      // Get current message to track status changes
      const currentResult = await this.fetchOne(id);
      if (currentResult.isErr()) {
        console.error(`[${new Date().toISOString()}] TursoMessagesStore.update: message ${id} not found`);
        return currentResult;
      }
      const currentMessage = currentResult.value;

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
        console.error(`[${new Date().toISOString()}] TursoMessagesStore.update: no rows affected for ${id}`);
        return err('Message not found');
      }

      console.log(`[${new Date().toISOString()}] TursoMessagesStore.update: ${result.rowsAffected} rows updated`);

      // Update stats if status changed
      if (data.status && data.status !== currentMessage.status) {
        console.log(`[${new Date().toISOString()}] TursoMessagesStore.update: status changed from ${currentMessage.status} to ${data.status}`);

        // Update status counters
        try {
          await this.statsService.decrementStatus(currentMessage.status, currentMessage.publish_at);
          await this.statsService.incrementStatus(data.status, currentMessage.publish_at);
        } catch (statsError) {
          console.error(`[${new Date().toISOString()}] TursoMessagesStore.update: stats update error:`, statsError);
        }
      }

      // Get updated message for logging
      console.log(`[${new Date().toISOString()}] TursoMessagesStore.update: fetching updated message`);
      const updatedResult = await this.fetchOne(id);
      if (updatedResult.isOk()) {
        console.log(`[${new Date().toISOString()}] TursoMessagesStore.update: got updated message with status ${updatedResult.value.status}`);
        // Create log if enabled
        if (this.logsStore && Env.get('ENABLE_LOGS') === 'true') {
          await this.logsStore.create({
            type: 'STORE_UPDATE_EVENT',
            object: this.getStoreName(),
            message_id: id,
            before_data: currentMessage,
            after_data: updatedResult.value,
          });
        }

        // Enqueue message for state processing (to match KV behavior)
        if (this.kv) {
          const systemMessage = {
            type: 'STORE_UPDATE_EVENT',
            object: this.getStoreName(),
            data: { before: currentMessage, after: updatedResult.value },
            id: `log_${Security.generateId()}`,
            created_at: new Date(),
          };
          console.log(
            `[${new Date().toISOString()}] Turso enqueuing STORE_UPDATE_EVENT for message ${id}, status change: ${currentMessage.status} -> ${updatedResult.value.status}`,
          );
          await this.kv.enqueue(systemMessage);
        } else {
          console.warn(`[${new Date().toISOString()}] Turso store has no KV instance, cannot enqueue state update for message ${id}`);
        }
      }

      return updatedResult;
    } catch (error: unknown) {
      return err(`Database error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async delete(id: string): Promise<Result<boolean, string>> {
    try {
      // Get message before deleting to update stats
      const messageResult = await this.fetchOne(id);

      const result = await this.sqlite.execute({
        sql: 'DELETE FROM messages WHERE id = :id',
        args: { id },
      });

      if (result.rowsAffected > 0 && messageResult.isOk()) {
        await this.statsService.decrementStatus(messageResult.value.status, messageResult.value.publish_at);
      }

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
