import { assertEquals, assertExists } from 'jsr:@std/assert';
import { afterEach, beforeEach, describe, it } from 'jsr:@std/testing/bdd';
import { z } from 'zod';
import { KvAdminRoutes } from '../../../src/routes/kv-admin-routes.ts';
import { MessageSchema } from '../../../src/schemas/message-schema.ts';
import { AuthMiddleware } from '../../../src/services/auth-middleware.ts';
import { KvMessagesStore } from '../../../src/stores/kv/kv-messages-store.ts';
import { KvLogsStore } from '../../../src/stores/kv/kv-logs-store.ts';
import { KvUtilStore } from '../../../src/stores/kv/kv-util-store.ts';
import { Routes } from '../../../src/utils/routes.ts';
import { VERSION_STRING } from '../../../src/version.ts';

describe('KvAdminRoutes integration tests', () => {
  let kv: Deno.Kv;
  let messageStore: KvMessagesStore;
  let adminRoutes: KvAdminRoutes;
  let app: ReturnType<typeof Routes.initHono>;

  beforeEach(async () => {
    kv = await Deno.openKv();
    messageStore = new KvMessagesStore(kv);
    const logsStore = new KvLogsStore(kv);
    adminRoutes = new KvAdminRoutes(messageStore, logsStore, kv);

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

  afterEach(async () => {
    await new KvUtilStore(kv).reset();
    kv.close();
    console.log('resetting kv store');
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
      assertEquals(typeof body.stats, 'object');
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
      assertEquals(typeof body.stats, 'object');
    });
  });

  describe('GET /admin/raw', () => {
    it('should return raw KV data', async () => {
      // Create a test message to ensure some data exists
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

    it('should filter raw data by match parameter', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/admin/raw/stores`, {
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
    it('should return log entries', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/admin/logs`, {
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

  describe('GET /admin/log/:messageId', () => {
    it('should return empty logs for non-existent message', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/admin/log/msg_nonexistent`, {
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      assertExists(body.message);
      assertEquals(body.message.includes('No logs found'), true);
      assertEquals(body.logs.length, 0);
      assertEquals(body.messageId, 'msg_nonexistent');
    });

    it('should return logs for message with activity', async () => {
      // First create and update a message to generate logs
      const message: z.infer<typeof MessageSchema> = {
        id: 'msg_test_logs',
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
      
      // Update the message to generate more logs
      await messageStore.update('msg_test_logs', { status: 'QUEUED' });

      const req = new Request(`http://localhost/${VERSION_STRING}/admin/log/msg_test_logs`, {
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      assertExists(body.logs);
      assertEquals(Array.isArray(body.logs), true);
      assertEquals(body.messageId, 'msg_test_logs');
      // Should have at least create and update logs if logging is enabled
      if (Deno.env.get('ENABLE_LOGS') === 'true') {
        assertEquals(body.logs.length >= 2, true);
      }
    });
  });

  describe('DELETE /admin/reset', () => {
    it('should reset all KV data', async () => {
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

      const req = new Request(`http://localhost/${VERSION_STRING}/admin/reset`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      assertEquals(body.message, 'fresh as new!');
    });

    it('should reset filtered KV data by match', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/admin/reset/messages`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      assertEquals(body.message, 'fresh as new!');
      assertEquals(body.match, 'messages');
    });
  });
});