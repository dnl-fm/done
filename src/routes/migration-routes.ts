import { Context } from 'hono';
import { Client } from 'libsql-core';
import { StatsService } from '../services/stats-service.ts';
import { StoreFactory } from '../stores/store-factory.ts';
import { Routes } from '../utils/routes.ts';
import { Env } from '../utils/env.ts';

/**
 * Routes for data migration between storage backends
 */
export class MigrationRoutes {
  private basePath = '/migrate';
  private routes = Routes.initHono({ basePath: this.basePath });

  constructor(
    private kv: Deno.Kv | undefined,
    private sqlite: Client | undefined,
  ) {}

  getBasePath(version: string) {
    return `/${version}${this.basePath}`;
  }

  getRoutes() {
    // Migrate data from KV to Turso
    this.routes.post('/kv-to-turso', async (c: Context) => {
      try {
        if (!this.kv || !this.sqlite) {
          return c.json({
            error: 'Both KV and SQLite must be available for migration',
          }, 400);
        }

        const targetDb = Env.get('TURSO_DB_URL');
        if (!targetDb) {
          return c.json({
            error: 'TURSO_DB_URL environment variable is required',
          }, 400);
        }

        let messageCount = 0;
        let logCount = 0;

        // Migrate messages
        const messageEntries = this.kv.list({ prefix: ['stores', 'messages'] });

        for await (const entry of messageEntries) {
          if (entry.key[2] !== 'secondaries' && entry.value && typeof entry.value === 'object') {
            const msg = entry.value as Record<string, unknown>;

            await this.sqlite.execute(
              `INSERT INTO messages (id, url, headers, payload, status, retry_count, 
                    last_errors, publish_at, created_at, updated_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                msg.id as string,
                msg.url as string,
                JSON.stringify(msg.headers || {}),
                JSON.stringify(msg.payload || {}),
                msg.status as string,
                msg.retry_count as number || 0,
                JSON.stringify(msg.last_errors || []),
                msg.publish_at as string,
                msg.created_at as string,
                (msg.updated_at || msg.created_at) as string,
              ],
            );
            messageCount++;
          }
        }

        // Migrate logs
        const logEntries = this.kv.list({ prefix: ['stores', 'logs'] });

        for await (const entry of logEntries) {
          if (entry.value && typeof entry.value === 'object') {
            const log = entry.value as Record<string, unknown>;

            await this.sqlite.execute(
              `INSERT INTO logs (id, type, message_id, before_data, after_data, created_at) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
              [
                log.id as string,
                log.type as string,
                log.message_id as string,
                JSON.stringify(log.before_data || null),
                JSON.stringify(log.after_data || null),
                log.created_at as string,
              ],
            );
            logCount++;
          }
        }

        return c.json({
          success: true,
          migrated: {
            messages: messageCount,
            logs: logCount,
          },
          target: targetDb,
        });
      } catch (error) {
        console.error('Migration error:', error);
        return c.json({
          error: 'Migration failed',
          details: error instanceof Error ? error.message : 'Unknown error',
        }, 500);
      }
    });

    // Initialize stats from existing messages (useful after migration)
    this.routes.post('/stats/initialize', async (c: Context) => {
      try {
        const storageType = StoreFactory.getStorageType();
        let statsService: StatsService;
        let messageCount = 0;

        if (storageType === 'TURSO' && this.sqlite) {
          statsService = new StatsService({ sqlite: this.sqlite });

          // Get all messages
          const result = await this.sqlite.execute('SELECT status, publish_at FROM messages');
          const messages = result.rows.map((row) => ({
            status: row.status as string,
            publish_at: new Date(row.publish_at as string),
          }));

          await statsService.initializeFromMessages(messages);
          messageCount = messages.length;
        } else if (storageType === 'KV' && this.kv) {
          statsService = new StatsService({ kv: this.kv });

          // Collect all messages from KV
          const messages: Array<{ status: string; publish_at: Date }> = [];
          const messageEntries = this.kv.list({ prefix: ['stores', 'messages'] });

          for await (const entry of messageEntries) {
            if (entry.key[2] !== 'secondaries' && entry.value && typeof entry.value === 'object') {
              const msg = entry.value as Record<string, unknown>;
              messages.push({
                status: msg.status as string,
                publish_at: new Date(msg.publish_at as string),
              });
            }
          }

          await statsService.initializeFromMessages(messages);
          messageCount = messages.length;
        } else {
          return c.json({
            error: 'Invalid storage configuration',
          }, 400);
        }

        return c.json({
          success: true,
          message: `Stats initialized from ${messageCount} messages`,
          storageType,
        });
      } catch (error) {
        console.error('Stats initialization error:', error);
        return c.json({
          error: 'Failed to initialize stats',
          details: error instanceof Error ? error.message : 'Unknown error',
        }, 500);
      }
    });

    return this.routes;
  }
}
