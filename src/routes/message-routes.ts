import { Context, Hono } from 'hono';
import { z } from 'zod';

import { VERSION } from '../main.ts';
import { MESSAGE_STATUS, MessagePayload, MessageReceivedData } from '../stores/message-model.ts';
import { MESSAGES_STORE_NAME, MessagesStore } from '../stores/messages-store.ts';
import { Http } from '../utils/http.ts';
import { Security } from '../utils/security.ts';
import { SYSTEM_MESSAGE_TYPE, SystemMessage } from '../utils/store.ts';

export const messageRoutes = (router: Hono, kv: Deno.Kv) => {
  const store = new MessagesStore(kv);
  const baseRouter = router.basePath(`/${VERSION}/messages`);

  baseRouter.get('/:id', async (ctx: Context) => {
    const id = ctx.req.param('id');
    const result = await store.fetch(id);

    if (result.err) {
      return ctx.json({ error: result.err }, 404);
    }

    return ctx.json(result.val);
  });

  baseRouter.get('/by-status/:status', async (ctx: Context) => {
    const status = ctx.req.param('status');
    const statusZod = z.object({ status: z.nativeEnum(MESSAGE_STATUS) });
    const validate = statusZod.safeParse({ status: status.toUpperCase() });

    if (!validate.success) {
      return ctx.json({ error: `Unknown status ${status}` }, 400);
    }

    const result = await store.fetchByStatus(validate.data.status);

    if (result.err) {
      return ctx.json({ error: result.err }, 404);
    }

    return ctx.json(result.val);
  });

  baseRouter.post('/:url{.*?}', async (ctx: Context) => {
    const nextId = store.buildModelIdWithPrefix();
    const callbackUrl = ctx.req.param('url');
    const publishAtDate = Http.delayExtract(ctx);
    const headers = Http.extractHeaders(ctx);

    const message = {
      id: Security.generateSortableId(),
      type: SYSTEM_MESSAGE_TYPE.MESSAGE_RECEIVED,
      object: MESSAGES_STORE_NAME,
      data: {
        id: nextId,
        publishAt: publishAtDate,
        payload: {
          headers,
          url: callbackUrl,
          data: Http.isJson(ctx) ? await ctx.req.json() : undefined,
        } as MessagePayload,
      } as MessageReceivedData,
      createdAt: new Date(),
    } as SystemMessage;

    console.log(`[${new Date().toISOString()}] enqueue new message`, message.data);

    const result = await kv.enqueue(message);

    console.log(`[${new Date().toISOString()}] result enqueued`, result);

    return ctx.json({ id: nextId, publishAt: publishAtDate.toISOString() }, 201);
  });
};
