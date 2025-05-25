import { assertEquals, assertExists } from 'jsr:@std/assert';
import { afterEach, beforeEach, describe, it } from 'jsr:@std/testing/bdd';
import { z } from 'zod';
import { Client } from 'libsql-core';
import { TursoAdminRoutes } from '../../../src/routes/turso-admin-routes.ts';
import { MessageSchema } from '../../../src/schemas/message-schema.ts';
import { AuthMiddleware } from '../../../src/services/auth-middleware.ts';
import { SqliteStore } from '../../../src/services/storage/sqlite-store.ts';
import { TursoMessagesStore } from '../../../src/stores/turso/turso-messages-store.ts';
import { TursoLogsStore } from '../../../src/stores/turso/turso-logs-store.ts';
import { Routes } from '../../../src/utils/routes.ts';
import { Migrations } from '../../../src/utils/migrations.ts';
import { VERSION_STRING } from '../../../src/version.ts';

describe('TursoAdminRoutes integration tests', () => {
  let sqliteStore: SqliteStore;
  let sqlite: Client;
  let messageStore: TursoMessagesStore;
  let adminRoutes: TursoAdminRoutes;
  let app: ReturnType<typeof Routes.initHono>;

  beforeEach(async () => {
    sqliteStore = new SqliteStore({ url: ':memory:' });
    sqlite = await sqliteStore.getClient();
    
    // Run migrations to create tables
    await new Migrations(sqliteStore).migrate({ force: true });
    
    messageStore = new TursoMessagesStore(sqlite);
    const logsStore = new TursoLogsStore(sqlite);
    adminRoutes = new TursoAdminRoutes(messageStore, logsStore, sqlite);

    // Set up auth token for tests
    Deno.env.set('AUTH_TOKEN', 'test-token');

    // Set up app with routes and auth
    app = Routes.initHono();
    app.use(
      `/${VERSION_STRING}/*`,
      AuthMiddleware.bearer({
        token: 'test-token',
        skipPaths: [],
      }),
    );
    app.route(adminRoutes.getBasePath(VERSION_STRING), adminRoutes.getRoutes());
  });

  afterEach(() => {
    sqlite.close();
    console.log('resetting turso store');
  });

  describe('GET /admin/stats', () => {
    it('should return empty stats when no data exists', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/admin/stats`, {
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      assertExists(body.stats);
      assertEquals(body.stats['messages/total'], 0);
    });

    it('should return stats with message data', async () => {
      // Create some test messages
      const message1: z.infer<typeof MessageSchema> = {
        id: 'msg_test1',
        payload: {
          headers: { forward: {}, command: {} },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'CREATED',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const message2: z.infer<typeof MessageSchema> = {
        id: 'msg_test2',
        payload: {
          headers: { forward: {}, command: {} },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'QUEUED',
        created_at: new Date(),
        updated_at: new Date(),
      };

      await messageStore.create(message1);
      await messageStore.create(message2);

      const req = new Request(`http://localhost/${VERSION_STRING}/admin/stats`, {
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      assertExists(body.stats);
      assertEquals(body.stats['messages/total'], 2);
      assertEquals(body.stats['messages/CREATED'], 1);
      assertEquals(body.stats['messages/QUEUED'], 1);
    });
  });

  describe('GET /admin/raw', () => {
    it('should return messages table data', async () => {
      // Create a test message
      const message: z.infer<typeof MessageSchema> = {
        id: 'msg_test1',
        payload: {
          headers: { forward: {}, command: {} },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'CREATED',
        created_at: new Date(),
        updated_at: new Date(),
      };

      await messageStore.create(message);

      const req = new Request(`http://localhost/${VERSION_STRING}/admin/raw/messages`, {
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      assertEquals(Array.isArray(body), true);
      assertEquals(body.length, 1);
      assertEquals(body[0].table, 'messages');
      assertExists(body[0].data);
    });

    it('should return migrations table data', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/admin/raw/migrations`, {
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      assertEquals(Array.isArray(body), true);
      // Should have at least the migration entries
      assertEquals(body.length >= 2, true);
      assertEquals(body[0].table, 'migrations');
    });

    it('should return error for unknown table', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/admin/raw/unknown`, {
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 400);

      const body = await res.json();
      assertEquals(body.message.includes('Unknown table'), true);
    });

    it('should return messages by default when no match specified', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/admin/raw`, {
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      assertEquals(Array.isArray(body), true);
    });
  });

  describe('GET /admin/logs', () => {
    it('should return empty logs array when no logs exist', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/admin/logs`, {
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      assertEquals(Array.isArray(body), true);
      assertEquals(body.length, 0);
    });
  });

  describe('GET /admin/log/:messageId', () => {
    it('should return empty logs for non-existent message', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/admin/log/msg_test`, {
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      assertExists(body.messageId);
      assertEquals(body.messageId, 'msg_test');
      assertEquals(Array.isArray(body.logs), true);
      assertEquals(body.logs.length, 0);
    });
  });

  describe('DELETE /admin/reset', () => {
    it('should reset messages table', async () => {
      // Create a test message
      const message: z.infer<typeof MessageSchema> = {
        id: 'msg_test1',
        payload: {
          headers: { forward: {}, command: {} },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'CREATED',
        created_at: new Date(),
        updated_at: new Date(),
      };

      await messageStore.create(message);

      const req = new Request(`http://localhost/${VERSION_STRING}/admin/reset/messages`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      assertEquals(body.message, 'Messages and logs tables reset!');
      assertEquals(body.match, 'messages');

      // Verify messages were deleted
      const fetchResult = await messageStore.fetchOne('msg_test1');
      assertEquals(fetchResult.isErr(), true);
    });

    it('should reset all messages when no match specified', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/admin/reset`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      assertEquals(body.message, 'Messages and logs tables reset!');
      assertEquals(body.match, 'all');
    });

    it('should reject migration table reset', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/admin/reset/migrations`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 400);

      const body = await res.json();
      assertEquals(body.message.includes('Cannot reset migrations table'), true);
    });

    it('should return error for unknown table', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/admin/reset/unknown`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 400);

      const body = await res.json();
      assertEquals(body.message.includes('Unknown table'), true);
    });
  });
});