import { Context } from 'hono';
import { Client } from 'libsql-core';
import { StatsService } from '../services/stats-service.ts';
import { SqliteStore } from '../services/storage/sqlite-store.ts';
import { MESSAGE_STATUS } from '../stores/kv/kv-message-model.ts';
import { StoreFactory } from '../stores/store-factory.ts';
import { Env } from '../utils/env.ts';
import { Routes } from '../utils/routes.ts';

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
          count: body?.count || 500,
          distribution: body?.distribution || {
            immediate: 15, // 15% immediate (next minute)
            scheduled: 25, // 25% scheduled (next 7 days)
            past: 60, // 60% past (last 30 days)
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

        // Create weighted distribution for more realistic data
        const weightedSessionIds: string[] = [];
        const weights = {
          'orders': 25, // 25% orders
          'users': 15, // 15% user events
          'payments': 20, // 20% payments
          'notifications': 20, // 20% notifications
          'analytics': 15, // 15% analytics
          'webhooks': 5, // 5% generic webhooks
        };

        for (const [id, weight] of Object.entries(weights)) {
          for (let i = 0; i < weight; i++) {
            weightedSessionIds.push(id);
          }
        }

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

        const messages: Array<{ type: 'immediate' | 'scheduled' | 'past' }> = [];

        // Generate message configs
        for (let i = 0; i < immediateCount; i++) {
          messages.push({ type: 'immediate' });
        }
        for (let i = 0; i < scheduledCount; i++) {
          messages.push({ type: 'scheduled' });
        }
        for (let i = 0; i < pastCount; i++) {
          messages.push({ type: 'past' });
        }

        // Shuffle for realistic distribution
        messages.sort(() => Math.random() - 0.5);

        // Create messages directly in the store with realistic status distribution
        const logsStore = this.kv && this.sqlite ? StoreFactory.getLogsStore({ kv: this.kv, sqlite: this.sqlite }) : undefined;
        const messagesStore = this.kv && this.sqlite
          ? StoreFactory.getMessagesStore({ kv: this.kv, sqlite: this.sqlite }, logsStore)
          : this.kv
          ? StoreFactory.getMessagesStore({ kv: this.kv })
          : null;

        if (!messagesStore) {
          return c.json({ error: 'No storage backend available' }, 500);
        }

        for (let i = 0; i < messages.length; i++) {
          const messageConfig = messages[i];
          const sessionId = weightedSessionIds[Math.floor(Math.random() * weightedSessionIds.length)];
          const url = `https://${sessionId}.gotrequests.com`;
          const payload = this.generatePayload(url);
          const publishAt = this.getScheduleTime(messageConfig.type);

          // Generate a unique ID
          const messageId = `MSG-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

          // Determine status based on message type and age
          let status: MESSAGE_STATUS = 'CREATED';
          let retryCount = 0;
          const lastErrors: Array<{ timestamp: string; error: string }> = [];

          if (messageConfig.type === 'past') {
            const messageTime = new Date(publishAt);
            const hoursAgo = (Date.now() - messageTime.getTime()) / (1000 * 60 * 60);

            // Messages older than 2 hours should be processed
            if (hoursAgo > 2) {
              const statusRoll = Math.random();

              if (statusRoll < 0.85) {
                status = 'SENT'; // 85% success rate
              } else if (statusRoll < 0.92) {
                status = 'DLQ'; // 7% to DLQ (no FAILED status)
                retryCount = 3;
                lastErrors.push({
                  timestamp: new Date(Date.now() - 3600000).toISOString(),
                  error: 'Connection timeout',
                });
              } else if (statusRoll < 0.95) {
                status = 'DLQ'; // 3% dead letter queue
                retryCount = 5;
                lastErrors.push({
                  timestamp: new Date(Date.now() - 7200000).toISOString(),
                  error: 'Max retries exceeded',
                });
              } else if (statusRoll < 0.98) {
                status = 'RETRY'; // 3% retrying
                retryCount = Math.floor(Math.random() * 3) + 1;
                lastErrors.push({
                  timestamp: new Date(Date.now() - 1800000).toISOString(),
                  error: 'Service unavailable',
                });
              } else {
                status = 'QUEUED'; // 2% still queued
              }
            } else if (hoursAgo > 0.5) {
              // Messages 30 min - 2 hours old might be queued or in progress
              status = Math.random() < 0.7 ? 'QUEUED' : 'DELIVER';
            }
          } else if (messageConfig.type === 'immediate') {
            // Immediate messages start as CREATED
            status = 'CREATED';
          } else {
            // Scheduled future messages
            status = 'CREATED';
          }

          try {
            // Create the message directly in the store
            const message = {
              id: messageId,
              payload: {
                headers: {
                  forward: {
                    'Content-Type': 'application/json',
                    'X-Webhook-ID': messageId,
                    'X-Webhook-Timestamp': new Date().toISOString(),
                  },
                  command: {},
                },
                url,
                data: payload,
              },
              status,
              retried: retryCount,
              last_errors: lastErrors.map((err) => ({
                url,
                message: err.error,
                created_at: new Date(err.timestamp),
              })),
              publish_at: new Date(publishAt),
              created_at: new Date(publishAt), // For historical data, created_at = publish_at
              updated_at: new Date(status !== 'CREATED' ? new Date(publishAt).getTime() + 30000 : publishAt),
            };

            await messagesStore.create(message);
            results.success++;
            results[messageConfig.type]++;
          } catch (_error) {
            results.failed++;
          }
        }

        // Initialize stats after seeding
        try {
          const statsService = new StatsService(storageType === 'KV' ? { kv: this.kv } : { sqlite: this.sqlite });
          const allMessages: Array<{ status: MESSAGE_STATUS; publish_at: Date }> = [];

          // Collect all messages we just created
          const messagesList = storageType === 'KV' && this.kv ? await this.collectKvMessages() : await this.collectSqliteMessages();

          for (const msg of messagesList) {
            allMessages.push({
              status: msg.status,
              publish_at: new Date(msg.publish_at),
            });
          }

          await statsService.initializeFromMessages(allMessages);
        } catch (statsError) {
          console.error('Failed to initialize stats:', statsError);
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
    // Extract session from webhook URL (e.g., https://orders.gotrequests.com)
    const urlMatch = webhookUrl.match(/https?:\/\/([^.]+)\.gotrequests\.com/);
    const session = urlMatch ? urlMatch[1] : 'unknown';

    // Realistic names for better dashboard appearance
    const firstNames = ['Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella', 'William', 'Mia', 'James', 'Charlotte', 'Benjamin', 'Amelia'];
    const lastNames = [
      'Smith',
      'Johnson',
      'Williams',
      'Brown',
      'Jones',
      'Garcia',
      'Miller',
      'Davis',
      'Rodriguez',
      'Martinez',
      'Hernandez',
      'Lopez',
      'Gonzalez',
      'Wilson',
      'Anderson',
    ];
    const companies = ['TechCorp', 'DataFlow', 'CloudSync', 'DevOps Pro', 'StartupHub', 'InnovateTech', 'Digital Dynamics', 'NextGen Solutions', 'FutureScale', 'SmartSystems'];
    const products = [
      'Analytics Dashboard',
      'API Gateway',
      'Cloud Storage',
      'Database Hosting',
      'Email Service',
      'File Sharing',
      'CRM Platform',
      'Project Management',
      'Video Streaming',
      'Payment Processing',
    ];
    const cities = [
      'New York',
      'Los Angeles',
      'Chicago',
      'Houston',
      'Phoenix',
      'Philadelphia',
      'San Antonio',
      'San Diego',
      'Dallas',
      'San Jose',
      'Austin',
      'Jacksonville',
      'Fort Worth',
      'Columbus',
      'Charlotte',
    ];
    const countries = ['US', 'CA', 'GB', 'DE', 'FR', 'JP', 'AU', 'NL', 'SE', 'CH'];

    // Generate realistic IDs
    const timestamp = Date.now();
    const randomNum = Math.floor(Math.random() * 9999);
    const uuid = `${timestamp.toString(36)}-${randomNum.toString(36)}`;

    // Random selections
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const company = companies[Math.floor(Math.random() * companies.length)];
    const product = products[Math.floor(Math.random() * products.length)];
    const city = cities[Math.floor(Math.random() * cities.length)];
    const country = countries[Math.floor(Math.random() * countries.length)];
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${company.toLowerCase().replace(/\s+/g, '')}.com`;

    // Session-specific payload templates
    const templates: Record<string, () => Record<string, unknown>> = {
      orders: () => ({
        event: 'order.created',
        orderId: `ORD-${timestamp}-${randomNum}`,
        customerId: `CUST-${uuid}`,
        customerName: `${firstName} ${lastName}`,
        customerEmail: email,
        items: [
          {
            productId: `PROD-${Math.floor(Math.random() * 100)}`,
            productName: product,
            quantity: Math.floor(Math.random() * 5) + 1,
            price: (Math.floor(Math.random() * 50000) / 100),
            currency: 'USD',
          },
        ],
        subtotal: (Math.floor(Math.random() * 50000) / 100),
        tax: (Math.floor(Math.random() * 5000) / 100),
        shipping: (Math.floor(Math.random() * 2000) / 100),
        total: (Math.floor(Math.random() * 60000) / 100),
        shippingAddress: {
          street: `${Math.floor(Math.random() * 9999)} Main St`,
          city: city,
          state: 'CA',
          country: country,
          postalCode: `${Math.floor(Math.random() * 90000) + 10000}`,
        },
        status: 'pending',
      }),

      users: () => ({
        event: 'user.registered',
        userId: `USER-${uuid}`,
        username: `${firstName.toLowerCase()}${lastName.toLowerCase()}${randomNum}`,
        email: email,
        fullName: `${firstName} ${lastName}`,
        company: company,
        plan: ['free', 'starter', 'pro', 'enterprise'][Math.floor(Math.random() * 4)],
        referralSource: ['google', 'facebook', 'twitter', 'linkedin', 'organic', 'email'][Math.floor(Math.random() * 6)],
        location: {
          city: city,
          country: country,
          timezone: 'America/New_York',
        },
        preferences: {
          newsletter: Math.random() > 0.5,
          notifications: Math.random() > 0.3,
          marketing: Math.random() > 0.7,
        },
      }),

      payments: () => ({
        event: 'payment.processed',
        paymentId: `PAY-${uuid}`,
        orderId: `ORD-${timestamp}-${randomNum}`,
        customerId: `CUST-${uuid}`,
        amount: (Math.floor(Math.random() * 100000) / 100),
        currency: 'USD',
        method: ['credit_card', 'debit_card', 'paypal', 'stripe', 'bank_transfer'][Math.floor(Math.random() * 5)],
        last4: Math.floor(Math.random() * 9000) + 1000,
        brand: ['visa', 'mastercard', 'amex', 'discover'][Math.floor(Math.random() * 4)],
        status: 'succeeded',
        description: `Payment for ${product}`,
        metadata: {
          customerEmail: email,
          invoiceNumber: `INV-${timestamp}`,
        },
      }),

      notifications: () => ({
        event: 'notification.sent',
        notificationId: `NOTIF-${uuid}`,
        recipientId: `USER-${uuid}`,
        recipientEmail: email,
        type: ['email', 'sms', 'push', 'in-app'][Math.floor(Math.random() * 4)],
        channel: ['transactional', 'marketing', 'system'][Math.floor(Math.random() * 3)],
        subject: [
          'Welcome to ' + company,
          'Your order has been shipped',
          'Payment confirmation',
          'Account security alert',
          'New features available',
          'Monthly newsletter',
        ][Math.floor(Math.random() * 6)],
        template: 'default',
        status: 'delivered',
        metadata: {
          campaignId: `CAMP-${Math.floor(Math.random() * 1000)}`,
          segmentId: `SEG-${Math.floor(Math.random() * 100)}`,
        },
      }),

      analytics: () => ({
        event: 'analytics.track',
        eventId: `EVENT-${uuid}`,
        userId: `USER-${uuid}`,
        sessionId: `SESSION-${uuid}`,
        eventName: ['page_view', 'button_click', 'form_submit', 'video_play', 'file_download', 'search', 'add_to_cart', 'checkout_start'][Math.floor(Math.random() * 8)],
        properties: {
          page: '/dashboard',
          referrer: 'https://google.com',
          browser: ['Chrome', 'Firefox', 'Safari', 'Edge'][Math.floor(Math.random() * 4)],
          device: ['desktop', 'mobile', 'tablet'][Math.floor(Math.random() * 3)],
          os: ['Windows', 'macOS', 'iOS', 'Android', 'Linux'][Math.floor(Math.random() * 5)],
        },
        context: {
          ip: `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          locale: 'en-US',
        },
      }),

      webhooks: () => ({
        event: 'webhook.triggered',
        webhookId: `WEBHOOK-${uuid}`,
        endpoint: webhookUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-ID': uuid,
          'X-Webhook-Timestamp': new Date().toISOString(),
        },
        payload: {
          action: ['created', 'updated', 'deleted', 'processed'][Math.floor(Math.random() * 4)],
          resource: ['order', 'user', 'payment', 'subscription', 'product'][Math.floor(Math.random() * 5)],
          resourceId: `RES-${uuid}`,
        },
        attempts: 1,
        status: 'pending',
      }),

      // Default fallback
      default: () => ({
        event: 'system.event',
        eventId: `SYS-${uuid}`,
        type: session,
        data: {
          message: `Event from ${session} service`,
          timestamp: new Date().toISOString(),
          source: webhookUrl,
        },
      }),
    };

    // Get template based on session or use default
    const templateFunc = templates[session] || templates.default;
    const payload = templateFunc();

    // Add common fields
    payload.timestamp = new Date().toISOString();
    payload.environment = ['production', 'staging', 'development'][Math.floor(Math.random() * 3)];
    payload.version = '2.1.0';
    payload.correlationId = `CORR-${uuid}`;

    return payload;
  }

  private async collectKvMessages(): Promise<Array<{ status: MESSAGE_STATUS; publish_at: string }>> {
    const messages: Array<{ status: MESSAGE_STATUS; publish_at: string }> = [];
    if (!this.kv) return messages;

    const entries = this.kv.list({ prefix: ['stores', 'messages'] });
    for await (const entry of entries) {
      if (entry.key[2] !== 'secondaries' && entry.value && typeof entry.value === 'object') {
        const msg = entry.value as Record<string, unknown>;
        if (msg.status && msg.publish_at) {
          messages.push({
            status: msg.status as MESSAGE_STATUS,
            publish_at: msg.publish_at as string,
          });
        }
      }
    }

    return messages;
  }

  private async collectSqliteMessages(): Promise<Array<{ status: MESSAGE_STATUS; publish_at: string }>> {
    const messages: Array<{ status: MESSAGE_STATUS; publish_at: string }> = [];
    if (!this.sqlite) return messages;

    const result = await this.sqlite.execute('SELECT status, publish_at FROM messages');
    for (const row of result.rows) {
      messages.push({
        status: row[0] as MESSAGE_STATUS,
        publish_at: row[1] as string,
      });
    }

    return messages;
  }

  private getScheduleTime(type: 'immediate' | 'scheduled' | 'past'): string {
    const now = new Date();

    switch (type) {
      case 'immediate':
        // Next 1-60 seconds
        return new Date(now.getTime() + Math.random() * 60000).toISOString();

      case 'scheduled': {
        // Distributed across next 7 days with bias towards business hours
        const daysAhead = Math.floor(Math.random() * 7);
        const baseTime = new Date(now);
        baseTime.setDate(baseTime.getDate() + daysAhead);

        // Bias towards business hours (9 AM - 6 PM)
        const hour = Math.random() < 0.7
          ? Math.floor(Math.random() * 9) + 9 // 70% during business hours
          : Math.floor(Math.random() * 24); // 30% any time

        baseTime.setHours(hour, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));
        return baseTime.toISOString();
      }

      case 'past': {
        // Last 30 days with realistic distribution
        const daysAgo = Math.floor(Math.random() * 30);
        const baseTime = new Date(now);
        baseTime.setDate(baseTime.getDate() - daysAgo);

        // Simulate realistic hourly distribution
        // Peak hours: 10-11 AM, 2-3 PM, 7-8 PM
        const hourWeights = [
          1,
          1,
          1,
          1,
          1,
          1,
          2,
          3,
          4,
          5, // 0-9 AM
          8,
          7,
          5,
          6,
          8,
          7,
          5,
          4,
          3,
          6, // 10 AM - 7 PM
          8,
          5,
          3,
          2, // 8-11 PM
        ];

        let hour = 0;
        const random = Math.random() * hourWeights.reduce((a, b) => a + b, 0);
        let sum = 0;
        for (let i = 0; i < hourWeights.length; i++) {
          sum += hourWeights[i];
          if (random < sum) {
            hour = i;
            break;
          }
        }

        baseTime.setHours(hour, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));
        return baseTime.toISOString();
      }

      default:
        return now.toISOString();
    }
  }
}
