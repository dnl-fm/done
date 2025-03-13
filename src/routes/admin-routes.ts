import { Context } from 'hono';
import { MessagesStoreInterface } from '../stores/messages-store-interface.ts';
import { Routes } from '../utils/routes.ts';

/**
 * Handles routing for admin-related endpoints.
 */
export class AdminRoutes {
  private basePath = `/admin`;
  private routes = Routes.initHono({ basePath: this.basePath });

  constructor(private readonly messageStore: MessagesStoreInterface) {}

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
      const stats: Record<string, number> = {};
      const entries = this.kv.list<MessageModel[]>({ prefix: [] });

      for await (const entry of entries) {
        const isSecondary = entry.key[2] === 'secondaries';
        const statsKey = entry.key.slice(1, isSecondary ? 5 : 2).join('/');

        if (isSecondary) {
          stats[statsKey] = entry.value.length;
          continue;
        }

        if (!stats[statsKey]) {
          stats[statsKey] = 0;
        }

        stats[statsKey]++;
      }

      return c.json({ stats });
    });

    async function storageFilterHandler(storage: StorageInterface, match?: string) {
      const data: unknown[] = [];
      const entries = storage.list({ prefix: [] });

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
    }

    this.routes.get('/raw/:match?', async (c: Context) => {
      return c.json(await storageFilterHandler(this.kv, c.req.param('match')));
    });

    this.routes.get('/logs', async (c: Context) => {
      const data = await storageFilterHandler(this.kv, 'stores/logging/log_');
      return c.json(data.reverse());
    });

    this.routes.get('/log/:messageId', async (c: Context) => {
      const messageId = c.req.param('messageId');
      const values = await this.kv.getSecondary<string[]>(KVStore.buildLogSecondaryKey(messageId));

      if (!values.value) {
        return c.json([]);
      }

      const data: unknown[] = [];

      for (const logId of values.value) {
        const value = await this.kv.get(KVStore.buildLogKey(logId));
        data.push(value.value);
      }

      return c.json(data.reverse());
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
