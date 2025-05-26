import { Context } from 'hono';
import { Client } from 'libsql-core';
import { MessagesStoreInterface } from '../interfaces/messages-store-interface.ts';
import { LogsStoreInterface } from '../interfaces/logs-store-interface.ts';
import { TursoLogsStore } from '../stores/turso/turso-logs-store.ts';
import { StatsService } from '../services/stats-service.ts';
import { Routes } from '../utils/routes.ts';

/**
 * Handles admin routing for Turso/SQLite storage backend.
 */
export class TursoAdminRoutes {
  private basePath = `/admin`;
  private routes = Routes.initHono({ basePath: this.basePath });
  private statsService: StatsService;

  constructor(
    private readonly messageStore: MessagesStoreInterface,
    private readonly logsStore: LogsStoreInterface,
    private readonly sqlite: Client,
  ) {
    this.statsService = new StatsService({ sqlite });
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
      try {
        // Get stats from the stats service
        const serviceStats = await this.statsService.getStats();

        // Build stats object for compatibility
        const stats: Record<string, number> = {};
        stats['messages/total'] = serviceStats.total;
        stats['messages/last24h'] = serviceStats.last24h;
        stats['messages/last7d'] = serviceStats.last7d;

        // Add status breakdown
        for (const [status, count] of Object.entries(serviceStats.byStatus)) {
          stats[`messages/${status}`] = count;
        }

        // Get logs count (not tracked by stats service)
        const logsResult = await this.sqlite.execute('SELECT COUNT(*) as count FROM logs');
        stats['logs'] = logsResult.rows[0]?.count as number || 0;

        // Get hourly state changes for today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const hourlyStateChanges = await this.getHourlyStateChanges(todayStart);

        return c.json({
          stats,
          trend7d: serviceStats.dailyTrend,
          hourlyActivity: serviceStats.hourlyActivity,
          hourlyStateChanges,
        });
      } catch (error) {
        console.error('Error getting stats:', error);
        return c.json({ error: 'Failed to retrieve stats' }, 500);
      }
    });


    this.routes.get('/raw/:match?', async (c: Context) => {
      const match = c.req.param('match');

      try {
        if (match === 'messages' || !match) {
          const result = await this.sqlite.execute('SELECT * FROM messages ORDER BY created_at DESC LIMIT 100');
          return c.json(result.rows.map((row) => ({ table: 'messages', data: row })));
        } else if (match === 'logs') {
          const result = await this.sqlite.execute('SELECT * FROM logs ORDER BY created_at DESC LIMIT 100');
          return c.json(result.rows.map((row) => ({ table: 'logs', data: row })));
        } else if (match === 'migrations') {
          const result = await this.sqlite.execute('SELECT * FROM migrations ORDER by applied_at DESC');
          return c.json(result.rows.map((row) => ({ table: 'migrations', data: row })));
        } else {
          return c.json({ message: `Unknown table: ${match}` }, 400);
        }
      } catch (error) {
        console.error('Error getting raw data:', error);
        return c.json({ error: 'Failed to retrieve raw data' }, 500);
      }
    });

    this.routes.get('/logs', async (c: Context) => {
      try {
        const logs = await (this.logsStore as TursoLogsStore).fetchAll(100);
        return c.json(logs);
      } catch (error) {
        console.error('Error fetching logs:', error);
        return c.json({ error: 'Failed to retrieve logs' }, 500);
      }
    });

    this.routes.get('/log/:messageId', async (c: Context) => {
      const messageId = c.req.param('messageId');
      try {
        const logs = await (this.logsStore as TursoLogsStore).fetchByMessageId(messageId);
        return c.json({ messageId, logs });
      } catch (error) {
        console.error('Error fetching logs for message:', error);
        return c.json({ error: 'Failed to retrieve logs for message' }, 500);
      }
    });

    this.routes.get('/logs', async (c: Context) => {
      try {
        const logs = await (this.logsStore as TursoLogsStore).fetchAll(100);
        return c.json(logs);
      } catch (error) {
        console.error('Error fetching logs:', error);
        return c.json({ error: 'Failed to retrieve logs' }, 500);
      }
    });

    this.routes.get('/logs/message/:messageId', async (c: Context) => {
      const messageId = c.req.param('messageId');

      try {
        const logs = await (this.logsStore as TursoLogsStore).fetchByMessageId(messageId);
        return c.json({ messageId, logs });
      } catch (error) {
        console.error('Error fetching logs for message:', error);
        return c.json({ error: 'Failed to retrieve logs for message' }, 500);
      }
    });

    this.routes.delete('/reset/:match?', async (c: Context) => {
      const match = c.req.param('match');

      try {
        if (match === 'messages' || !match) {
          await this.sqlite.execute('DELETE FROM messages');
          await (this.logsStore as TursoLogsStore).reset();
          return c.json({ message: 'Messages and logs tables reset!', match: match || 'all' });
        } else if (match === 'logs') {
          await (this.logsStore as TursoLogsStore).reset();
          return c.json({ message: 'Logs table reset!', match });
        } else if (match === 'migrations') {
          return c.json({
            message: 'Cannot reset migrations table - this would break the database structure',
          }, 400);
        } else {
          return c.json({ message: `Unknown table: ${match}` }, 400);
        }
      } catch (error) {
        console.error('Error resetting data:', error);
        return c.json({ error: 'Failed to reset data' }, 500);
      }
    });

    return this.routes;
  }

  private async getHourlyStateChanges(startDate: Date): Promise<
    Array<{
      hour: number;
      created: number;
      queued: number;
      delivering: number;
      sent: number;
      retry: number;
      failed: number;
      dlq: number;
    }>
  > {
    try {
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);

      console.log('Getting hourly state changes from', startDate.toISOString(), 'to', endDate.toISOString());

      // Query logs for state changes today
      // Note: created_at is now stored as ISO timestamp
      const query = `
        SELECT 
          strftime('%H', created_at) as hour,
          type,
          before_data,
          after_data
        FROM logs
        WHERE created_at >= ? 
          AND created_at < ?
          AND type = 'STORE_UPDATE_EVENT'
        ORDER BY created_at ASC
      `;

      const result = await this.sqlite.execute({
        sql: query,
        args: [startDate.toISOString(), endDate.toISOString()],
      });

      console.log('Found', result.rows.length, 'state change logs');

      // Initialize hourly buckets
      const hourlyStats = Array(24).fill(null).map((_, hour) => ({
        hour,
        created: 0,
        queued: 0,
        delivering: 0,
        sent: 0,
        retry: 0,
        failed: 0,
        dlq: 0,
      }));

      // Process each log entry
      for (const row of result.rows) {
        const hour = parseInt(row.hour as string);
        const afterData = typeof row.after_data === 'string' ? JSON.parse(row.after_data) : row.after_data;

        if (afterData && afterData.status) {
          const status = afterData.status.toLowerCase();
          switch (status) {
            case 'created':
              hourlyStats[hour].created++;
              break;
            case 'queued':
              hourlyStats[hour].queued++;
              break;
            case 'deliver':
              hourlyStats[hour].delivering++;
              break;
            case 'sent':
              hourlyStats[hour].sent++;
              break;
            case 'retry':
              hourlyStats[hour].retry++;
              break;
            case 'failed':
              hourlyStats[hour].failed++;
              break;
            case 'dlq':
              hourlyStats[hour].dlq++;
              break;
          }
        }
      }

      // Also count message creations
      const createQuery = `
        SELECT 
          strftime('%H', created_at) as hour,
          COUNT(*) as count
        FROM logs
        WHERE created_at >= ? 
          AND created_at < ?
          AND type = 'STORE_CREATE_EVENT'
        GROUP BY hour
      `;

      const createResult = await this.sqlite.execute({
        sql: createQuery,
        args: [startDate.toISOString(), endDate.toISOString()],
      });

      for (const row of createResult.rows) {
        const hour = parseInt(row.hour as string);
        hourlyStats[hour].created += row.count as number;
      }

      return hourlyStats;
    } catch (error) {
      console.error('Error getting hourly state changes:', error);
      return Array(24).fill(null).map((_, hour) => ({
        hour,
        created: 0,
        queued: 0,
        delivering: 0,
        sent: 0,
        retry: 0,
        failed: 0,
        dlq: 0,
      }));
    }
  }
}
