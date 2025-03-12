import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { MessageStateManager } from './managers/message-state-manager.ts';
import { adminRoutes } from './routes/admin-routes.ts';
import { messageRoutes } from './routes/message-routes.ts';
import { MESSAGE_STATUS } from './stores/message-model.ts';
import { MessagesStore } from './stores/messages-store.ts';
import { Security } from './utils/security.ts';
import { SystemMessage } from './utils/store.ts';

export const VERSION = 'v1';

const kv = await Deno.openKv();
const router = new Hono();
router.use(`/${VERSION}/*`, bearerAuth({ token: Deno.env.get('AUTH_TOKEN') || Security.generateAuthToken() }));

// ##############################################
// add cron

Deno.cron('enqueue todays messages', '0 0 * * *', async () => {
  console.log(`[${new Date().toISOString()}] cron: check for todays messages`);

  const store = new MessagesStore(kv);
  const messagesResult = await store.fetchByDate(new Date());

  if (messagesResult.isOk()) {
    const messages = messagesResult.value;
    for (const message of messages) {
      if (message.status === MESSAGE_STATUS.CREATED) {
        console.debug(`[${new Date().toISOString()}] cron: deliver message ${message.id}`);
        await store.update(message.id, { status: MESSAGE_STATUS.QUEUED });
      }
    }
  }
});

// ##############################################
// handle incoming messages

kv.listenQueue(async (incoming: unknown) => {
  const message = incoming as SystemMessage;
  console.log(`[${new Date().toISOString()}] received message ${message.id} with type ${message.type}`);
  await new MessageStateManager(kv).handleState(message);
});

// ############################################
// routes

messageRoutes(router, kv);
adminRoutes(router, kv);

// ############################################

Deno.serve({ port: 3001 }, router.fetch);
