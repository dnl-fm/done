import { Context, Hono } from 'hono';

import { VERSION } from '../main.ts';
import { MessageModel } from '../stores/message-model.ts';
import { Store } from '../utils/store.ts';

export const adminRoutes = (router: Hono, kv: Deno.Kv) => {
  const baseRouter = router.basePath(`/${VERSION}/admin`);

  baseRouter.get(`/stats`, async (ctx: Context) => {
    const stats: Record<string, number> = {};
    const entries = kv.list<MessageModel[]>({ prefix: [] });

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

    return ctx.json({ stats });
  });

  async function kvFilterHandler(match?: string) {
    const data: unknown[] = [];
    const entries = kv.list({ prefix: [] });

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

  baseRouter.get(`/raw/:match?`, async (ctx: Context) => {
    return ctx.json(await kvFilterHandler(ctx.req.param('match')));
  });

  baseRouter.get(`/logs`, async (ctx: Context) => {
    const data = await kvFilterHandler('stores/logging/log_');
    return ctx.json(data.reverse());
  });

  baseRouter.get(`/log/:messageId`, async (ctx: Context) => {
    const messageId = ctx.req.param('messageId');
    const values = await kv.get<string[]>(Store.buildLogSecondaryKey(messageId));

    if (!values.value) {
      return ctx.json([]);
    }

    const data: unknown[] = [];

    for (const logId of values.value) {
      const value = await kv.get(Store.buildLogKey(logId));
      data.push(value.value);
    }

    return ctx.json(data.reverse());
  });

  baseRouter.delete(`/reset/:match?`, async (ctx: Context) => {
    const match = ctx.req.param('match');
    const entries = kv.list({ prefix: [] });

    for await (const entry of entries) {
      const keyPath = Array.from(entry.key).join('/');

      // if match is provided, only delete entries that match the path
      if (match && keyPath.indexOf(`stores/${match}`) === -1) {
        continue;
      }

      await kv.delete(entry.key);
    }

    return ctx.json({ message: 'fresh as new!', match });
  });
};
