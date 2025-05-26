import { Context } from 'hono';
import { Client } from 'libsql-core';
import { StatsService } from '../services/stats-service.ts';
import { MESSAGE_STATUS } from '../stores/kv/kv-message-model.ts';
import { StoreFactory } from '../stores/store-factory.ts';
import { Routes } from '../utils/routes.ts';
import { Security } from '../utils/security.ts';

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

          // Generate a unique ID with slight time offset to avoid duplicates
          const messageId = `MSG-${Date.now() + i}-${Math.random().toString(36).substring(2, 9)}`;

          // Distribute created_at across today's hours for better visualization
          const createdAt = this.getDistributedCreatedAt(i, messages.length);

          // Determine status based on message type and age
          let status: MESSAGE_STATUS = 'CREATED';
          let retryCount = 0;
          const lastErrors: Array<{ timestamp: string; error: string }> = [];

          if (messageConfig.type === 'past') {
            const messageTime = new Date(publishAt);
            const hoursAgo = (Date.now() - messageTime.getTime()) / (1000 * 60 * 60);

            // Messages older than 1 hour should be processed
            if (hoursAgo > 1) {
              const statusRoll = Math.random();

              if (statusRoll < 0.85) {
                status = 'SENT'; // 85% success rate
              } else if (statusRoll < 0.92) {
                status = 'DLQ'; // 7% to DLQ (no FAILED status)
                retryCount = 3;
                // Add multiple realistic errors for DLQ messages
                lastErrors.push(
                  {
                    timestamp: new Date(Date.now() - 7200000).toISOString(),
                    error: 'HTTP 500: Internal Server Error - The webhook endpoint returned an error',
                  },
                  {
                    timestamp: new Date(Date.now() - 5400000).toISOString(),
                    error: 'HTTP 503: Service Unavailable - The service is temporarily unavailable',
                  },
                  {
                    timestamp: new Date(Date.now() - 3600000).toISOString(),
                    error: 'Connection timeout after 30 seconds - The remote server did not respond',
                  },
                );
              } else if (statusRoll < 0.95) {
                status = 'DLQ'; // 3% dead letter queue
                retryCount = 5;
                // Add progression of errors leading to DLQ
                lastErrors.push(
                  {
                    timestamp: new Date(Date.now() - 14400000).toISOString(),
                    error: 'HTTP 404: Not Found - The webhook endpoint does not exist',
                  },
                  {
                    timestamp: new Date(Date.now() - 10800000).toISOString(),
                    error: 'HTTP 404: Not Found - The webhook endpoint does not exist',
                  },
                  {
                    timestamp: new Date(Date.now() - 7200000).toISOString(),
                    error: 'HTTP 404: Not Found - The webhook endpoint does not exist',
                  },
                  {
                    timestamp: new Date(Date.now() - 3600000).toISOString(),
                    error: 'HTTP 404: Not Found - The webhook endpoint does not exist',
                  },
                  {
                    timestamp: new Date(Date.now() - 1800000).toISOString(),
                    error: 'Max retries exceeded - Message moved to dead letter queue',
                  },
                );
              } else if (statusRoll < 0.98) {
                status = 'RETRY'; // 3% retrying
                retryCount = Math.floor(Math.random() * 3) + 1;
                // Add recent error for retry status
                const errorTypes = [
                  'HTTP 502: Bad Gateway - The server received an invalid response',
                  'HTTP 503: Service Unavailable - The service is temporarily down for maintenance',
                  'Connection reset by peer - The remote server closed the connection unexpectedly',
                  'HTTP 429: Too Many Requests - Rate limit exceeded',
                ];
                lastErrors.push({
                  timestamp: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
                  error: errorTypes[Math.floor(Math.random() * errorTypes.length)],
                });
              } else {
                status = 'QUEUED'; // 2% still queued
              }
            } else if (hoursAgo > 0.5) {
              // Messages 30 min - 1 hour old might be queued or in progress
              const roll = Math.random();
              if (roll < 0.4) {
                status = 'QUEUED';
              } else if (roll < 0.7) {
                status = 'DELIVER';
              } else {
                status = 'SENT'; // Some messages process quickly
              }
            }
          } else if (messageConfig.type === 'immediate') {
            // Immediate messages should be processed quickly
            const roll = Math.random();
            if (roll < 0.85) {
              status = 'SENT'; // 85% success
            } else if (roll < 0.92) {
              status = 'DLQ'; // 7% fail
              retryCount = 3;
            } else {
              status = 'RETRY'; // 8% retrying
              retryCount = 1;
            }
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
              created_at: createdAt,
              updated_at: createdAt,
            };

            if (storageType === 'KV' && this.kv) {
              // For KV storage, bypass the create method to preserve our created_at timestamp
              const kvMessage = {
                ...message,
                last_errors: lastErrors.map((err) => ({
                  url,
                  message: err.error,
                  created_at: new Date(err.timestamp),
                })),
              };
              
              // Set the message directly in KV
              await this.kv.set(['stores', 'messages', messageId], kvMessage);
              
              // Add secondary indexes
              const statusIndex = await this.kv.get<string[]>(['stores', 'messages', 'secondaries', 'BY_STATUS', status]);
              await this.kv.set(['stores', 'messages', 'secondaries', 'BY_STATUS', status], 
                [...(statusIndex?.value || []), messageId]
              );
              
              const dateKey = createdAt.toISOString().split('T')[0];
              const dateIndex = await this.kv.get<string[]>(['stores', 'messages', 'secondaries', 'BY_PUBLISH_DATE', dateKey]);
              await this.kv.set(['stores', 'messages', 'secondaries', 'BY_PUBLISH_DATE', dateKey],
                [...(dateIndex?.value || []), messageId]
              );
            } else if (storageType === 'TURSO' && this.sqlite) {
              // For TURSO storage, insert directly to preserve created_at timestamp
              await this.sqlite.execute({
                sql: `INSERT INTO messages (
                  id, payload, publish_at, delivered_at, retry_at, retried, status, last_errors, created_at, updated_at
                ) VALUES (:id, :payload, :publish_at, :delivered_at, :retry_at, :retried, :status, :last_errors, :created_at, :updated_at)`,
                args: {
                  id: messageId,
                  payload: JSON.stringify(message.payload),
                  publish_at: message.publish_at.toISOString(),
                  delivered_at: null,
                  retry_at: null,
                  retried: message.retried,
                  status: message.status,
                  last_errors: message.last_errors.length > 0 ? JSON.stringify(message.last_errors) : null,
                  created_at: createdAt.toISOString(),
                  updated_at: createdAt.toISOString(),
                },
              });
              
              // Create log entry for message creation
              const logId = `log_${Security.generateId()}`;
              await this.sqlite.execute({
                sql: `INSERT INTO logs (
                  id, type, object, message_id, before_data, after_data, created_at
                ) VALUES (:id, :type, :object, :message_id, :before_data, :after_data, :created_at)`,
                args: {
                  id: logId,
                  type: 'STORE_CREATE_EVENT',
                  object: 'messages',
                  message_id: messageId,
                  before_data: JSON.stringify(null),
                  after_data: JSON.stringify(message),
                  created_at: createdAt.toISOString(),
                },
              });
              
              // Create state change logs for all messages that should have transitions
              const shouldHaveTransitions = (messageConfig.type === 'past' && status !== 'CREATED') || 
                                          (messageConfig.type === 'immediate') ||
                                          (messageConfig.type === 'scheduled' && new Date(publishAt) <= new Date());
              
              if (shouldHaveTransitions) {
                // Simulate state transitions for realistic log history
                const transitions: Array<{ from: string; to: string; time: Date }> = [];
                
                // Most transitions should happen within the same hour as creation
                let currentTime = new Date(createdAt);
                
                // All messages start as CREATED
                transitions.push({ from: 'CREATED', to: 'QUEUED', time: new Date(currentTime.getTime() + 30000) }); // 30 seconds later
                
                if (status === 'SENT' || status === 'DLQ' || status === 'RETRY') {
                  // Add DELIVER state - within 5 minutes
                  currentTime = new Date(currentTime.getTime() + 300000); // 5 minutes after creation
                  transitions.push({ from: 'QUEUED', to: 'DELIVER', time: currentTime });
                  
                  if (status === 'SENT') {
                    // Success case - complete within 10 minutes
                    currentTime = new Date(currentTime.getTime() + 300000); // Another 5 minutes
                    transitions.push({ from: 'DELIVER', to: 'SENT', time: currentTime });
                  } else if (status === 'RETRY' || status === 'DLQ') {
                    // Failed delivery - first retry within 15 minutes
                    currentTime = new Date(currentTime.getTime() + 600000); // 10 minutes
                    transitions.push({ from: 'DELIVER', to: 'RETRY', time: currentTime });
                    
                    if (status === 'DLQ' && retryCount > 0) {
                      // Multiple retries before DLQ - exponential backoff
                      for (let i = 1; i < retryCount && i < 3; i++) {
                        // Exponential backoff: 15min, 30min, 60min
                        currentTime = new Date(currentTime.getTime() + (900000 * Math.pow(2, i-1))); // 15min * 2^(i-1)
                        transitions.push({ from: 'RETRY', to: 'DELIVER', time: currentTime });
                        currentTime = new Date(currentTime.getTime() + 300000); // 5 min delivery attempt
                        transitions.push({ from: 'DELIVER', to: 'RETRY', time: currentTime });
                      }
                      
                      // Final transition to DLQ after last retry
                      currentTime = new Date(currentTime.getTime() + 1800000); // 30 minutes after last retry
                      transitions.push({ from: 'RETRY', to: 'DLQ', time: currentTime });
                    }
                  }
                }
                
                // Create log entries for each transition
                for (const transition of transitions) {
                  const transitionLogId = `log_${Security.generateId()}`;
                  const beforeState = { ...message, status: transition.from };
                  const afterState = { ...message, status: transition.to };
                  
                  await this.sqlite.execute({
                    sql: `INSERT INTO logs (
                      id, type, object, message_id, before_data, after_data, created_at
                    ) VALUES (:id, :type, :object, :message_id, :before_data, :after_data, :created_at)`,
                    args: {
                      id: transitionLogId,
                      type: 'STORE_UPDATE_EVENT',
                      object: 'messages',
                      message_id: messageId,
                      before_data: JSON.stringify(beforeState),
                      after_data: JSON.stringify(afterState),
                      created_at: transition.time.toISOString(),
                    },
                  });
                }
              }
            } else {
              // For other storage types, use the normal create method
              await messagesStore.create(message);
            }
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

    return this.routes;
  }

  private generatePayload(webhookUrl: string): Record<string, unknown> {
    // Extract session from webhook URL (e.g., https://orders.gotrequests.com)
    const urlMatch = webhookUrl.match(/https?:\/\/([^.]+)\.gotrequests\.com/);
    const session = urlMatch ? urlMatch[1] : 'unknown';

    // Realistic names for better dashboard appearance
    const firstNames = ['Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella', 'William', 'Mia', 'James', 'Charlotte', 'Benjamin', 'Amelia'];
    const lastNames = [
      'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez',
      'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor',
      'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez',
      'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright',
      'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker',
      'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts'
    ];
    const companies = ['TechCorp', 'GlobalSoft', 'DataSystems', 'CloudWorks', 'NetSolutions', 'InfoTech', 'DigitalHub', 'CyberFlow', 'WebMasters', 'AppDynamics', 'SystemPro', 'TechFlow', 'DataSync', 'CloudBase', 'NetForce', 'InfoStream', 'DigitalCore', 'CyberTech', 'WebFlow', 'AppStream', 'InnovateTech', 'FutureSoft', 'SmartSystems', 'NextGen', 'TechPulse'];
    const products = [
      'Analytics Dashboard', 'Cloud Storage', 'API Gateway', 'Database Manager', 'Security Suite',
      'Project Tracker', 'Email Service', 'Chat Platform', 'Video Streaming', 'File Sync',
      'Code Editor', 'Task Manager', 'CRM System', 'Inventory Tool', 'Payment Gateway',
      'Search Engine', 'Content Platform', 'Mobile SDK', 'DevOps Suite', 'AI Assistant'
    ];
    const cities = [
      'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio',
      'San Diego', 'Dallas', 'San Jose', 'Austin', 'Jacksonville', 'Fort Worth', 'Columbus',
      'San Francisco', 'Charlotte', 'Indianapolis', 'Seattle', 'Denver', 'Washington DC',
      'Boston', 'El Paso', 'Detroit', 'Nashville', 'Portland', 'Memphis', 'Oklahoma City',
      'Las Vegas', 'Louisville', 'Baltimore', 'Milwaukee', 'Albuquerque', 'Tucson', 'Fresno',
      'Mesa', 'Sacramento', 'Atlanta', 'Kansas City', 'Colorado Springs', 'Miami', 'Raleigh',
      'Omaha', 'Long Beach', 'Virginia Beach', 'Oakland', 'Minneapolis', 'Tulsa', 'Arlington',
      'Tampa', 'New Orleans'
    ];
    const countries = ['US', 'CA', 'UK', 'DE', 'FR', 'JP', 'AU', 'BR', 'IN', 'CN', 'MX', 'ES', 'IT', 'NL', 'SE', 'CH', 'NO', 'DK', 'FI', 'BE'];

    const timestamp = new Date().toISOString();
    const randomNum = Math.floor(Math.random() * 10000);
    const uuid = `${session.toUpperCase()}-mb57xy${String.fromCharCode(97 + Math.floor(Math.random() * 26))}${String.fromCharCode(97 + Math.floor(Math.random() * 26))}-${randomNum % 1000}`;

    // Generate consistent data
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const company = companies[Math.floor(Math.random() * companies.length)];
    const product = products[Math.floor(Math.random() * products.length)];
    const city = cities[Math.floor(Math.random() * cities.length)];
    const country = countries[Math.floor(Math.random() * countries.length)];
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${company.toLowerCase().replace(/\s+/g, '')}.com`;

    // Templates based on webhook session
    const templates: Record<string, () => Record<string, unknown>> = {
      orders: () => ({
        event: 'order.created',
        orderId: `ORD-${timestamp.slice(0, 10).replace(/-/g, '')}-${randomNum}`,
        customerId: uuid,
        customerName: `${firstName} ${lastName}`,
        customerEmail: email,
        items: [
          {
            productId: `PROD-${Math.floor(Math.random() * 1000)}`,
            productName: product,
            quantity: Math.floor(Math.random() * 5) + 1,
            price: (Math.random() * 500 + 50).toFixed(2),
          }
        ],
        totalAmount: (Math.random() * 1000 + 100).toFixed(2),
        currency: 'USD',
        status: 'pending',
        shippingAddress: {
          street: `${Math.floor(Math.random() * 9999) + 1} Main St`,
          city: city,
          state: 'CA',
          country: country,
          zipCode: `${Math.floor(Math.random() * 90000) + 10000}`,
        },
        timestamp,
        environment: Math.random() > 0.7 ? 'production' : 'staging',
        version: '2.1.0',
      }),
      users: () => ({
        event: 'user.registered',
        userId: uuid,
        username: `${firstName.toLowerCase()}${lastName.toLowerCase()}${randomNum}`,
        email,
        fullName: `${firstName} ${lastName}`,
        company,
        plan: ['free', 'basic', 'pro', 'enterprise'][Math.floor(Math.random() * 4)],
        referralSource: ['google', 'facebook', 'twitter', 'direct', 'email'][Math.floor(Math.random() * 5)],
        location: {
          city,
          country,
          timezone: 'America/New_York',
        },
        preferences: {
          newsletter: Math.random() > 0.5,
          notifications: Math.random() > 0.3,
          marketing: Math.random() > 0.7,
        },
        timestamp,
        environment: Math.random() > 0.7 ? 'production' : 'staging',
        version: '2.1.0',
        correlationId: `CORR-${uuid}`,
      }),
      payments: () => ({
        event: 'payment.processed',
        paymentId: `PAY-${uuid}`,
        orderId: `ORD-${timestamp.slice(0, 10).replace(/-/g, '')}-${randomNum}`,
        customerId: uuid,
        amount: (Math.random() * 1000 + 50).toFixed(2),
        currency: 'USD',
        method: ['credit_card', 'paypal', 'stripe', 'apple_pay'][Math.floor(Math.random() * 4)],
        last4: Math.floor(Math.random() * 9000) + 1000,
        brand: ['visa', 'mastercard', 'amex', 'discover'][Math.floor(Math.random() * 4)],
        status: 'succeeded',
        description: `Payment for ${product}`,
        metadata: {
          customerEmail: email,
          invoiceNumber: `INV-${timestamp.slice(0, 10).replace(/-/g, '')}`,
        },
        timestamp,
        environment: Math.random() > 0.7 ? 'production' : 'staging',
        version: '2.1.0',
        correlationId: `CORR-${uuid}`,
      }),
      notifications: () => ({
        event: 'notification.sent',
        notificationId: `NOTIF-${uuid}`,
        recipientId: uuid,
        recipientEmail: email,
        type: ['email', 'sms', 'push', 'in_app'][Math.floor(Math.random() * 4)],
        subject: `Update from ${company}`,
        content: 'Your recent activity has been processed successfully.',
        status: 'delivered',
        metadata: {
          campaign: 'transactional',
          priority: ['high', 'medium', 'low'][Math.floor(Math.random() * 3)],
          tags: ['user_action', 'system_update', 'marketing'][Math.floor(Math.random() * 3)],
        },
        deliveredAt: timestamp,
        timestamp,
        environment: Math.random() > 0.7 ? 'production' : 'staging',
        version: '2.1.0',
        correlationId: `CORR-${uuid}`,
      }),
      analytics: () => ({
        event: 'analytics.track',
        eventId: `EVENT-${uuid}`,
        userId: uuid,
        sessionId: `SESSION-${uuid}`,
        eventName: ['page_view', 'button_click', 'form_submit', 'file_download'][Math.floor(Math.random() * 4)],
        properties: {
          page: ['/home', '/dashboard', '/settings', '/profile'][Math.floor(Math.random() * 4)],
          referrer: ['https://google.com', 'https://facebook.com', 'direct', 'https://twitter.com'][Math.floor(Math.random() * 4)],
          browser: ['Chrome', 'Firefox', 'Safari', 'Edge'][Math.floor(Math.random() * 4)],
          device: ['desktop', 'mobile', 'tablet'][Math.floor(Math.random() * 3)],
          os: ['Windows', 'macOS', 'iOS', 'Android', 'Linux'][Math.floor(Math.random() * 5)],
        },
        context: {
          ip: `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`,
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          locale: 'en-US',
        },
        timestamp,
        environment: Math.random() > 0.7 ? 'production' : 'staging',
        version: '2.1.0',
        correlationId: `CORR-${uuid}`,
      }),
      webhooks: () => ({
        event: 'webhook.processed',
        webhookId: `WEBHOOK-${uuid}`,
        url: webhookUrl,
        method: 'POST',
        status: 'success',
        responseTime: Math.floor(Math.random() * 500) + 50,
        statusCode: 200,
        attempts: 1,
        payload: {
          messageId: uuid,
          timestamp,
          type: 'system_event',
          data: {
            action: `${session}_processed`,
            source: 'api',
            target: webhookUrl,
            metadata: {
              version: '1.0',
              environment: Math.random() > 0.7 ? 'production' : 'staging',
            },
          },
        },
        timestamp,
        environment: Math.random() > 0.7 ? 'production' : 'staging',
        version: '2.1.0',
        correlationId: `CORR-${uuid}`,
      }),
      default: () => ({
        event: `${session}.event`,
        eventId: uuid,
        timestamp,
        source: session,
        data: {
          message: `Event from ${session}`,
          session,
          randomValue: Math.random(),
          processedAt: timestamp,
        },
        metadata: {
          environment: Math.random() > 0.7 ? 'production' : 'staging',
          version: '1.0.0',
          correlationId: `CORR-${uuid}`,
        },
      }),
    };

    return templates[session] ? templates[session]() : templates.default();
  }

  private async collectKvMessages(): Promise<Array<{ status: MESSAGE_STATUS; publish_at: string }>> {
    const messages: Array<{ status: MESSAGE_STATUS; publish_at: string }> = [];
    if (this.kv) {
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
    }
    return messages;
  }

  private async collectSqliteMessages(): Promise<Array<{ status: MESSAGE_STATUS; publish_at: string }>> {
    const messages: Array<{ status: MESSAGE_STATUS; publish_at: string }> = [];
    if (this.sqlite) {
      const result = await this.sqlite.execute('SELECT status, publish_at FROM messages');
      for (const row of result.rows) {
        messages.push({
          status: row.status as MESSAGE_STATUS,
          publish_at: row.publish_at as string,
        });
      }
    }
    return messages;
  }

  private getDistributedCreatedAt(index: number, total: number): Date {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    // Calculate the time span from start of day to now
    const hoursFromMidnight = (now.getTime() - startOfDay.getTime()) / (60 * 60 * 1000);

    // Distribute messages evenly across today's hours (from midnight to now)
    const hourOffset = hoursFromMidnight * (index / total);
    const createdTime = new Date(startOfDay.getTime() + hourOffset * 60 * 60 * 1000);

    // Add some randomness within the hour (0-59 minutes)
    const minuteOffset = Math.floor(Math.random() * 60);
    const secondOffset = Math.floor(Math.random() * 60);
    createdTime.setMinutes(minuteOffset, secondOffset);

    return createdTime;
  }

  private getScheduleTime(type: 'immediate' | 'scheduled' | 'past'): string {
    const now = Date.now();

    if (type === 'immediate') {
      return new Date(now).toISOString();
    } else if (type === 'scheduled') {
      // Schedule 1-48 hours in the future
      const hoursInFuture = Math.floor(Math.random() * 48) + 1;
      return new Date(now + hoursInFuture * 60 * 60 * 1000).toISOString();
    } else {
      // Past messages: 1 hour to 7 days ago
      const hoursAgo = Math.floor(Math.random() * 168) + 1;
      return new Date(now - hoursAgo * 60 * 60 * 1000).toISOString();
    }
  }
}
