import { Context } from 'hono';
import { StoreFactory } from '../stores/store-factory.ts';
import { StatsService } from '../services/stats-service.ts';
import { SqliteStore } from '../services/storage/sqlite-store.ts';
import { MESSAGE_STATUS } from '../stores/kv/kv-message-model.ts';
import { Routes } from '../utils/routes.ts';
import { Client } from 'libsql-core';
import { Env } from '../utils/env.ts';

interface SeedConfig {
  count?: number;
  distribution?: {
    immediate: number;
    scheduled: number;
    past: number;
  };
}

/**
 * Utility routes for maintenance and data operations
 */
export class UtilityRoutes {
  private basePath = '/util';
  private routes = Routes.initHono({ basePath: this.basePath });

  constructor(
    private readonly kv?: Deno.Kv,
    private readonly sqlite?: Client,
  ) {}

  getBasePath(version: string) {
    return `/${version}/${this.basePath.replace('/', '')}`;
  }

  getRoutes() {
    // Seed messages using gotrequests.com
    this.routes.post('/seed', async (c: Context) => {
      try {
        const body = await c.req.json().catch(() => ({} as SeedConfig));

        const config = {
          count: body?.count || 100,
          distribution: body?.distribution || {
            immediate: 20,
            scheduled: 30,
            past: 50,
          },
        };

        // Reset database first - ensuring both storage types are handled equally
        const storageType = StoreFactory.getStorageType();
        if (storageType === 'KV' && this.kv) {
          // For KV: Delete all entries (messages, logs, stats, everything)
          const entries = this.kv.list({ prefix: [] });
          for await (const entry of entries) {
            await this.kv.delete(entry.key);
          }
        } else if (this.sqlite) {
          // For SQLite: Delete from all relevant tables
          await this.sqlite.execute('DELETE FROM messages');
          await this.sqlite.execute('DELETE FROM logs');
          await this.sqlite.execute('DELETE FROM message_stats');
        }

        // Generate session IDs for gotrequests.com
        const sessionIds = [
          'orders',
          'users',
          'payments',
          'notifications',
          'analytics',
          'webhooks',
          'events',
          'alerts',
          'reports',
          'backups',
          'inventory',
          'subscriptions',
          'tasks',
          'emails',
          'sms',
        ];

        const webhookUrls = sessionIds.map((id) => `https://${id}.gotrequests.com`);

        // Calculate message counts
        const immediateCount = Math.floor(config.count * config.distribution.immediate / 100);
        const scheduledCount = Math.floor(config.count * config.distribution.scheduled / 100);
        const pastCount = config.count - immediateCount - scheduledCount;

        const results = {
          success: 0,
          failed: 0,
          immediate: 0,
          scheduled: 0,
          past: 0,
        };

        const messages = [];

        // Generate message configs
        for (let i = 0; i < immediateCount; i++) {
          messages.push({ type: 'immediate' as const });
        }
        for (let i = 0; i < scheduledCount; i++) {
          messages.push({ type: 'scheduled' as const });
        }
        for (let i = 0; i < pastCount; i++) {
          messages.push({ type: 'past' as const });
        }

        // Shuffle for realistic distribution
        messages.sort(() => Math.random() - 0.5);

        // Create messages
        const baseUrl = new URL(c.req.url).origin;
        const authHeader = c.req.header('Authorization') || '';

        for (let i = 0; i < messages.length; i++) {
          const messageConfig = messages[i];
          const url = webhookUrls[Math.floor(Math.random() * webhookUrls.length)];
          const payload = this.generatePayload(url);
          const publishAt = this.getScheduleTime(messageConfig.type);

          try {
            await this.createMessage(baseUrl, url, payload, publishAt, authHeader);
            results.success++;
            results[messageConfig.type]++;
          } catch (_error) {
            results.failed++;
          }
        }

        return c.json({
          message: 'Seeding completed',
          results,
          config,
          storageType,
        });
      } catch (error) {
        console.error('Seeding error:', error);
        return c.json({
          error: 'Failed to seed messages',
          details: error instanceof Error ? error.message : 'Unknown error',
        }, 500);
      }
    });

    // Initialize stats from existing messages
    this.routes.post('/stats/initialize', async (c: Context) => {
      try {
        const storageType = StoreFactory.getStorageType();
        let statsService: StatsService;
        let messages: Array<{ status: MESSAGE_STATUS; publish_at: Date }> = [];

        if (storageType === 'KV' && this.kv) {
          statsService = new StatsService({ kv: this.kv });

          // Get all messages from KV
          const entries = this.kv.list({ prefix: ['stores', 'messages'] });

          for await (const entry of entries) {
            if (entry.key[2] !== 'secondaries' && entry.value && typeof entry.value === 'object') {
              const msg = entry.value as Record<string, unknown>;
              if (msg.status && msg.publish_at) {
                messages.push({
                  status: msg.status as MESSAGE_STATUS,
                  publish_at: new Date(msg.publish_at as string),
                });
              }
            }
          }
        } else if (this.sqlite) {
          statsService = new StatsService({ sqlite: this.sqlite });

          // Get all messages from SQLite
          const result = await this.sqlite.execute('SELECT status, publish_at FROM messages');
          messages = result.rows.map((row) => ({
            status: row[0] as MESSAGE_STATUS,
            publish_at: new Date(row[1] as string),
          }));
        } else {
          return c.json({ error: 'No storage backend available' }, 500);
        }

        await statsService.initializeFromMessages(messages);

        return c.json({
          message: 'Stats initialized successfully',
          messagesProcessed: messages.length,
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

    // Migrate data from KV to Turso
    this.routes.post('/migrate/kv-to-turso', async (c: Context) => {
      try {
        if (!this.kv) {
          return c.json({ error: 'KV storage not available' }, 400);
        }

        const dbUrl = Env.get('TURSO_DB_URL');
        const authToken = Env.get('TURSO_DB_AUTH_TOKEN');

        if (!dbUrl) {
          return c.json({ error: 'Turso configuration not found' }, 400);
        }

        const sqliteStore = new SqliteStore({ url: dbUrl as URL | ':memory:', authToken });
        const targetSqlite = await sqliteStore.getClient();

        let messageCount = 0;
        let logCount = 0;
        let statsCount = 0;

        // Migrate messages
        const messageEntries = this.kv.list({ prefix: ['stores', 'messages'] });

        for await (const entry of messageEntries) {
          if (entry.key[2] !== 'secondaries' && entry.value && typeof entry.value === 'object') {
            const msg = entry.value as Record<string, unknown>;

            await targetSqlite.execute(
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

            await targetSqlite.execute(
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

        // Migrate stats - reconstruct from messages since KV uses counters
        const statsService = new StatsService({ sqlite: targetSqlite });
        const allMessages: Array<{ status: MESSAGE_STATUS; publish_at: Date }> = [];

        const msgEntries = this.kv.list({ prefix: ['stores', 'messages'] });
        for await (const entry of msgEntries) {
          if (entry.key[2] !== 'secondaries' && entry.value && typeof entry.value === 'object') {
            const msg = entry.value as Record<string, unknown>;
            if (msg.status && msg.publish_at) {
              allMessages.push({
                status: msg.status as MESSAGE_STATUS,
                publish_at: new Date(msg.publish_at as string),
              });
            }
          }
        }

        if (allMessages.length > 0) {
          await statsService.initializeFromMessages(allMessages);
          statsCount = allMessages.length;
        }

        return c.json({
          message: 'Migration completed successfully',
          migrated: {
            messages: messageCount,
            logs: logCount,
            statsInitialized: statsCount,
          },
        });
      } catch (error) {
        console.error('Migration error:', error);
        return c.json({
          error: 'Failed to migrate data',
          details: error instanceof Error ? error.message : 'Unknown error',
        }, 500);
      }
    });

    return this.routes;
  }

  private generatePayload(webhookUrl: string): Record<string, unknown> {
    const templates = [
      { event: 'order.created', orderId: 'ORD-', amount: 0, currency: 'USD' },
      { event: 'user.registered', userId: 'USER-', email: '', plan: 'free' },
      { event: 'payment.completed', paymentId: 'PAY-', amount: 0, status: 'completed' },
      { event: 'subscription.renewed', subscriptionId: 'SUB-', plan: '' },
      { event: 'notification.sent', notificationId: 'NOTIF-', type: 'email' },
    ];

    const template = templates[Math.floor(Math.random() * templates.length)];
    const payload = JSON.parse(JSON.stringify(template)) as Record<string, unknown>;
    const randomId = Math.floor(Math.random() * 9999);

    // Extract session from webhook URL (e.g., https://orders.gotrequests.com)
    const urlMatch = webhookUrl.match(/https?:\/\/([^.]+)\.gotrequests\.com/);
    const session = urlMatch ? urlMatch[1] : 'unknown';

    // Fill dynamic values
    if ('orderId' in payload) payload.orderId = `${payload.orderId}${randomId}`;
    if ('userId' in payload) payload.userId = `${payload.userId}${randomId}`;
    if ('paymentId' in payload) payload.paymentId = `${payload.paymentId}${randomId}`;
    if ('subscriptionId' in payload) payload.subscriptionId = `${payload.subscriptionId}${randomId}`;
    if ('notificationId' in payload) payload.notificationId = `${payload.notificationId}${randomId}`;

    if ('amount' in payload) payload.amount = Math.floor(Math.random() * 10000) / 100;
    if ('email' in payload) payload.email = `user${randomId}@example.com`;
    if ('plan' in payload) payload.plan = ['free', 'pro', 'enterprise'][Math.floor(Math.random() * 3)];
    if ('type' in payload && payload.event === 'notification.sent') {
      payload.type = ['email', 'sms', 'push'][Math.floor(Math.random() * 3)];
    }

    payload.timestamp = new Date().toISOString();
    payload.session = session;
    payload.metadata = {
      source: 'done-utility-seeder',
      environment: 'development',
      version: '1.0.0',
      gotrequests_session: session,
    };

    return payload;
  }

  private getScheduleTime(type: 'immediate' | 'scheduled' | 'past'): string {
    const now = new Date();

    switch (type) {
      case 'immediate':
        return new Date(now.getTime() + Math.random() * 60000).toISOString();
      case 'scheduled': {
        const hoursAhead = Math.floor(Math.random() * 24 * 7);
        return new Date(now.getTime() + hoursAhead * 3600000).toISOString();
      }
      case 'past': {
        const hoursAgo = Math.floor(Math.random() * 24 * 30);
        return new Date(now.getTime() - hoursAgo * 3600000).toISOString();
      }
      default:
        return now.toISOString();
    }
  }

  private async createMessage(baseUrl: string, url: string, payload: Record<string, unknown>, publishAt: string, authHeader: string) {
    // The full URL (e.g., https://orders.gotrequests.com) should be passed as the endpoint parameter
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    // Add delay header for scheduling
    if (publishAt) {
      const delay = new Date(publishAt).getTime() - Date.now();
      if (delay > 0) {
        headers['X-Delay'] = `${Math.floor(delay / 1000)}s`;
      }
    }

    // The API expects the full URL in the path after /v1/messages/
    const response = await fetch(`${baseUrl}/v1/messages/${url}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create message: ${response.status} - ${errorText}`);
    }

    return response.json();
  }
}
