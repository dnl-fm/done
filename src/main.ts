import { Context } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { MessageStateManager } from './managers/message-state-manager.ts';
import { AdminRoutes } from './routes/admin-routes.ts';
import { MessageRoutes } from './routes/message-routes.ts';
import { SystemMessage } from './services/storage/kv-store.ts';
import { SqliteStore } from './services/storage/sqlite-store.ts';
import { StoreFactory } from './stores/store-factory.ts';
import { Routes } from './utils/routes.ts';
import { Security } from './utils/security.ts';
import { VERSION_STRING } from './version.ts';

// Initialize message store
const kv = await Deno.openKv();
const sqlite = await SqliteStore.create(Deno.env.get('TURSO_DB_URL') || ':memory:', Deno.env.get('TURSO_DB_AUTH_TOKEN') || undefined);
const messageStore = StoreFactory.getMessagesStore({ kv, sqlite });

// Initialize Hono with Routes utility
const hono = Routes.initHono();

// Add middleware
hono.use(`/${VERSION_STRING}/*`, bearerAuth({ token: Deno.env.get('AUTH_TOKEN') || Security.generateAuthToken() }));

// Add error handler
hono.onError((error: Error, c: Context) => {
  console.error(error);
  return c.json({ error: 'An error occurred. We have been notified.' }, 500);
});

// ##############################################
// add cron

Deno.cron('enqueue todays messages', '0 0 * * *', async () => {
  console.log(`[${new Date().toISOString()}] cron: check for todays messages`);

  const messagesResult = await messageStore.fetchByDate(new Date());

  if (messagesResult.isOk()) {
    const messages = messagesResult.value;
    for (const message of messages) {
      if (message.status === 'CREATED') {
        console.debug(`[${new Date().toISOString()}] cron: deliver message ${message.id}`);
        await messageStore.update(message.id, { status: 'QUEUED' });
      }
    }
  }
});

// ##############################################
// handle incoming messages

kv.listenQueue(async (incoming: unknown) => {
  const message = incoming as SystemMessage;
  console.log(`[${new Date().toISOString()}] received message ${message.id} with type ${message.type}`);
  await new MessageStateManager(kv, messageStore).handleState(message);
});

// ############################################
// routes

const routes = [
  new MessageRoutes(kv, messageStore),
  new AdminRoutes(kv),
];

for (const route of routes) {
  hono.route(route.getBasePath(VERSION_STRING), route.getRoutes());
}

// ############################################

Deno.serve({ port: 3001 }, hono.fetch);
