import { Context } from 'hono';
import { MessageStateManager } from './managers/message-state-manager.ts';
import { KvAdminRoutes } from './routes/kv-admin-routes.ts';
import { MessageRoutes } from './routes/message-routes.ts';
import { SystemRoutes } from './routes/system-routes.ts';
import { TursoAdminRoutes } from './routes/turso-admin-routes.ts';
import { UtilityRoutes } from './routes/utility-routes.ts';
import { DashboardRoutes } from './routes/dashboard-routes.ts';
import { AuthMiddleware } from './services/auth-middleware.ts';
import { SystemMessage } from './services/storage/kv-store.ts';
import { SqliteStore } from './services/storage/sqlite-store.ts';
import { StoreFactory } from './stores/store-factory.ts';
import { Env } from './utils/env.ts';
import { Routes } from './utils/routes.ts';
import { Security } from './utils/security.ts';
import { VERSION_STRING } from './version.ts';

// Initialize stores
const kv = await Deno.openKv();
const storageType = StoreFactory.getStorageType();
let sqlite = undefined;

// Initialize SQLite if using Turso
if (storageType === 'TURSO') {
  const dbUrl = new URL(Env.get('TURSO_DB_URL'), import.meta.url);
  const authToken = Env.get('TURSO_DB_AUTH_TOKEN');

  // Create SqliteStore instance for migrations
  const sqliteStore = new SqliteStore({ url: dbUrl, authToken });

  console.log('Running database migrations...');
  const { Migrations } = await import('./utils/migrations.ts');
  const migrations = new Migrations(sqliteStore);
  await migrations.migrate();
  console.log('Migrations completed.');

  // Get the client for store usage
  sqlite = await sqliteStore.getClient();
}

const logsStore = StoreFactory.getLogsStore({ kv, sqlite });
const messageStore = StoreFactory.getMessagesStore({ kv, sqlite }, logsStore);

// Initialize Hono with Routes utility
const hono = Routes.initHono();

// Add middleware
hono.use(
  `/${VERSION_STRING}/*`,
  AuthMiddleware.bearer({
    token: Env.get('AUTH_TOKEN') || Security.generateAuthToken(),
    skipPaths: [`/${VERSION_STRING}/system/ping`],
  }),
);

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

// Create admin routes based on storage type
const adminRoutes = storageType === 'KV' ? new KvAdminRoutes(messageStore, logsStore, kv) : new TursoAdminRoutes(messageStore, logsStore, sqlite!);

// Register API routes with version prefix
const apiRoutes = [
  new MessageRoutes(kv, messageStore),
  adminRoutes,
  new SystemRoutes(),
  new UtilityRoutes(kv, sqlite),
];

for (const route of apiRoutes) {
  hono.route(route.getBasePath(VERSION_STRING), route.getRoutes());
}

// Register dashboard without version prefix
const dashboardRoutes = new DashboardRoutes();
hono.route(dashboardRoutes.getBasePath(), dashboardRoutes.getRoutes());

// Serve static files
hono.get('/done.jpg', async (c) => {
  try {
    const file = await Deno.readFile('./done.jpg');
    return c.body(file, 200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400', // Cache for 1 day
    });
  } catch (error) {
    console.error('Error serving logo:', error);
    return c.text('Logo not found', 404);
  }
});

// ############################################

Deno.serve({ port: 3001 }, hono.fetch);
