import { Context } from 'hono';
import { Client } from 'libsql-core';
import { MessagesStoreInterface } from '../interfaces/messages-store-interface.ts';
import { LogsStoreInterface } from '../interfaces/logs-store-interface.ts';
import { TursoLogsStore } from '../stores/turso/turso-logs-store.ts';
import { Routes } from '../utils/routes.ts';

/**
 * Handles admin routing for Turso/SQLite storage backend.
 */
export class TursoAdminRoutes {
  private basePath = `/admin`;
  private routes = Routes.initHono({ basePath: this.basePath });

  constructor(
    private readonly messageStore: MessagesStoreInterface,
    private readonly logsStore: LogsStoreInterface,
    private readonly sqlite: Client
  ) {}

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
        // Get message counts by status
        const stats: Record<string, number> = {};
        
        const statusResult = await this.sqlite.execute(`
          SELECT status, COUNT(*) as count 
          FROM messages 
          GROUP BY status
        `);

        for (const row of statusResult.rows) {
          stats[`messages/${row.status as string}`] = row.count as number;
        }

        // Get total count
        const totalResult = await this.sqlite.execute('SELECT COUNT(*) as total FROM messages');
        stats['messages/total'] = totalResult.rows[0]?.total as number || 0;

        return c.json({ stats });
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
          return c.json(result.rows.map(row => ({ table: 'messages', data: row })));
        } else if (match === 'migrations') {
          const result = await this.sqlite.execute('SELECT * FROM migrations ORDER BY applied_at DESC');
          return c.json(result.rows.map(row => ({ table: 'migrations', data: row })));
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
            message: 'Cannot reset migrations table - this would break the database structure' 
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
}