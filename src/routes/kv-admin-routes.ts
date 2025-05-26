import { Context } from 'hono';
import { MessagesStoreInterface } from '../interfaces/messages-store-interface.ts';
import { LogsStoreInterface } from '../interfaces/logs-store-interface.ts';
import { AbstractKvStore } from '../stores/kv/abstract-kv-store.ts';
import { StatsService } from '../services/stats-service.ts';
import { Routes } from '../utils/routes.ts';

/**
 * Handles admin routing for KV storage backend.
 */
export class KvAdminRoutes {
  private basePath = `/admin`;
  private routes = Routes.initHono({ basePath: this.basePath });
  private statsService: StatsService;

  constructor(
    private readonly messageStore: MessagesStoreInterface,
    private readonly logsStore: LogsStoreInterface,
    private readonly kv: Deno.Kv,
  ) {
    this.statsService = new StatsService({ kv });
  }

  /**
   * Gets the versioned base path for admin routes.
   * @param {string} version - API version string.
   * @returns {string} The complete base path including version.
   */
  getBasePath(version: string) {
    return `/${version}/${this.basePath.replace('/', '')}`;
  }

  getRoutes() {
    this.routes.get('/stats', async (c: Context) => {
      // Get stats from the stats service
      const serviceStats = await this.statsService.getStats();

      // Get additional KV store stats (logs, etc)
      const stats: Record<string, number> = {};
      const entries = this.kv.list({ prefix: [] });

      for await (const entry of entries) {
        const isSecondary = entry.key[2] === 'secondaries';
        const statsKey = entry.key.slice(1, isSecondary ? 5 : 2).join('/');

        if (isSecondary) {
          stats[statsKey] = Array.isArray(entry.value) ? entry.value.length : 0;
          continue;
        }

        if (!stats[statsKey]) {
          stats[statsKey] = 0;
        }

        stats[statsKey]++;
      }

      // Merge counter-based stats with other KV stats
      stats['messages'] = serviceStats.total;
      stats['messages/last24h'] = serviceStats.last24h;
      stats['messages/last7d'] = serviceStats.last7d;

      // Add status breakdown
      for (const [status, count] of Object.entries(serviceStats.byStatus)) {
        stats[`messages/secondaries/BY_STATUS/${status}`] = count;
      }

      // For KV, hourly state changes would need to be tracked differently
      // This is a placeholder - in production, we'd need to implement
      // a way to track state changes by hour in KV
      const hourlyStateChanges = Array(24).fill(null).map((_, hour) => ({
        hour,
        created: 0,
        queued: 0,
        delivering: 0,
        sent: 0,
        retry: 0,
        failed: 0,
        dlq: 0,
      }));

      return c.json({
        stats,
        trend7d: serviceStats.dailyTrend,
        hourlyActivity: serviceStats.hourlyActivity,
        hourlyStateChanges,
      });
    });

    this.routes.post('/stats/initialize', async (c: Context) => {
      try {
        // Get all messages
        const messages: Array<{ status: string; publish_at: Date }> = [];
        const entries = this.kv.list({ prefix: ['stores', 'messages'] });

        for await (const entry of entries) {
          if (entry.key[2] !== 'secondaries' && entry.value && typeof entry.value === 'object') {
            const msg = entry.value as Record<string, unknown>;
            if (msg.status && typeof msg.status === 'string' && msg.publish_at) {
              messages.push({
                status: msg.status,
                publish_at: new Date(msg.publish_at as string),
              });
            }
          }
        }

        // Initialize stats from messages
        await this.statsService.initializeFromMessages(messages);

        return c.json({
          success: true,
          message: `Stats initialized from ${messages.length} messages`,
        });
      } catch (error) {
        console.error('Error initializing stats:', error);
        return c.json({ error: 'Failed to initialize stats' }, 500);
      }
    });

    const storageFilterHandler = async (match?: string) => {
      const data: unknown[] = [];
      const entries = this.kv.list({ prefix: [] });

      for await (const entry of entries) {
        const key = Array.from(entry.key);
        const keyPath = key.join('/');

        // if match is provided, only show entries that match the path
        if (match && keyPath.indexOf(match) === -1) {
          continue;
        }

        data.push({ key: keyPath, value: entry.value });
      }

      return data;
    };

    this.routes.get('/raw/:match?', async (c: Context) => {
      return c.json(await storageFilterHandler(c.req.param('match')));
    });

    this.routes.get('/logs', async (c: Context) => {
      const data = await storageFilterHandler('stores/logging/log_');
      return c.json(data.reverse());
    });

    this.routes.get('/log/:messageId', async (c: Context) => {
      const messageId = c.req.param('messageId');

      try {
        // Get log IDs for this message from secondary index
        const secondaryKey = AbstractKvStore.buildLogSecondaryKey(messageId);
        const logIdsResult = await this.kv.get<string[]>(secondaryKey);

        if (!logIdsResult.value || logIdsResult.value.length === 0) {
          return c.json({
            message: `No logs found for message ${messageId}`,
            messageId,
            logs: [],
          });
        }

        // Fetch all log entries for this message
        const logs: unknown[] = [];
        for (const logId of logIdsResult.value) {
          const logKey = AbstractKvStore.buildLogKey(logId);
          const logEntry = await this.kv.get(logKey);
          if (logEntry.value) {
            logs.push(logEntry.value);
          }
        }

        // Sort logs by creation time (most recent first)
        const sortedLogs = logs.sort((a: unknown, b: unknown) => {
          const aLog = a as { created_at: string };
          const bLog = b as { created_at: string };
          const dateA = new Date(aLog.created_at).getTime();
          const dateB = new Date(bLog.created_at).getTime();
          return dateB - dateA;
        });

        return c.json({
          message: `Found ${logs.length} log entries for message ${messageId}`,
          messageId,
          logs: sortedLogs,
        });
      } catch (error) {
        console.error('Error retrieving logs for message:', messageId, error);
        return c.json({
          error: 'Failed to retrieve logs',
          messageId,
          logs: [],
        }, 500);
      }
    });

    this.routes.delete('/reset/:match?', async (c: Context) => {
      const match = c.req.param('match');
      const entries = this.kv.list({ prefix: [] });

      for await (const entry of entries) {
        const keyPath = Array.from(entry.key).join('/');

        // if match is provided, only delete entries that match the path
        if (match && keyPath.indexOf(`stores/${match}`) === -1) {
          continue;
        }

        await this.kv.delete(entry.key);
      }

      return c.json({ message: 'fresh as new!', match });
    });

    return this.routes;
  }
}
