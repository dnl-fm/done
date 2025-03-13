import { z } from 'zod';
import { MessageReceivedDataSchema, MessageReceivedResponseSchema, MessageStatusSchema } from '../schemas/message-schema.ts';
import { SYSTEM_MESSAGE_TYPE, SystemMessage } from '../services/storage/kv-store.ts';
import { MESSAGES_STORE_NAME } from '../stores/kv-messages-store.ts';
import { MessagesStoreInterface } from '../stores/messages-store-interface.ts';
import { Http } from '../utils/http.ts';
import { Routes } from '../utils/routes.ts';
import { Security } from '../utils/security.ts';

export class MessageRoutes {
  private basePath = `/messages`;
  private routes = Routes.initHono({ basePath: this.basePath });

  constructor(
    private readonly kv: Deno.Kv,
    private readonly messageStore: MessagesStoreInterface,
  ) {}

  getBasePath(version: string) {
    return `/${version}/${this.basePath.replace('/', '')}`;
  }

  getRoutes() {
    this.routes.get('/:id', async (c) => {
      const id = c.req.param('id');
      const result = await this.messageStore.fetchOne(id);

      if (result.isErr()) {
        return c.json({ error: result.error }, 404);
      }

      return c.json(result.value);
    });

    this.routes.get('/by-status/:status', async (c) => {
      const status = c.req.param('status');
      const validate = MessageStatusSchema.safeParse(status.toUpperCase());

      if (!validate.success) {
        return c.json({ error: `Unknown status ${status}` }, 400);
      }

      const result = await this.messageStore.fetchByStatus(validate.data);

      if (result.isErr()) {
        return c.json({ error: result.error }, 404);
      }

      return c.json(result.value);
    });

    this.routes.post('/:url{.*?}', async (c) => {
      const nextId = this.messageStore.buildModelIdWithPrefix();
      const callbackUrl = c.req.param('url');
      const publishAtDate = Http.delayExtract(c);
      const headers = Http.extractHeaders(c);

      const message = {
        id: Security.generateSortableId(),
        type: SYSTEM_MESSAGE_TYPE.MESSAGE_RECEIVED,
        object: MESSAGES_STORE_NAME,
        data: {
          id: nextId,
          publish_at: publishAtDate,
          payload: {
            headers,
            url: callbackUrl,
            data: Http.isJson(c) ? await c.req.json() : undefined,
          },
        } as z.infer<typeof MessageReceivedDataSchema>,
        created_at: new Date(),
      } as SystemMessage;

      console.log(`[${new Date().toISOString()}] enqueue new message`, message.data);

      await this.kv.enqueue(message);

      console.log(`[${new Date().toISOString()}] message enqueued with id ${nextId}`);

      return c.json({ id: nextId, publish_at: publishAtDate.toISOString() } as z.infer<typeof MessageReceivedResponseSchema>, 201);
    });

    return this.routes;
  }
}
