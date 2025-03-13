import { assertEquals, assertExists } from 'jsr:@std/assert';
import { afterEach, beforeEach, describe, it } from 'jsr:@std/testing/bdd';
import { Client } from 'libsql-core';
import { z } from 'zod';
import { MessageRoutes } from '../../src/routes/message-routes.ts';
import { MessageReceivedResponseSchema, MessageSchema } from '../../src/schemas/message-schema.ts';
import { SqliteStore } from '../../src/services/storage/sqlite-store.ts';
import { KvStore } from '../../src/stores/kv-store.ts';
import { TursoMessagesStore } from '../../src/stores/turso-messages-store.ts';
import { Migrations } from '../../src/utils/migrations.ts';
import { Routes } from '../../src/utils/routes.ts';
import { VERSION_STRING } from '../../src/version.ts';

describe('MessageRoutes', () => {
  let kv: Deno.Kv;
  let client: Client;
  let sqliteStore: SqliteStore;
  let messageStore: TursoMessagesStore;
  let routes: MessageRoutes;
  let app: ReturnType<typeof Routes.initHono>;

  beforeEach(async () => {
    // Setup KV store
    kv = await Deno.openKv();

    // Setup SQLite store
    sqliteStore = new SqliteStore({ url: ':memory:' });
    await new Migrations(sqliteStore).migrate({ force: true });
    client = await sqliteStore.getClient();
    messageStore = new TursoMessagesStore(client);

    // Setup routes
    routes = new MessageRoutes(kv, messageStore);
    app = Routes.initHono();
    app.route(`/${VERSION_STRING}/messages`, routes.getRoutes());
  });

  afterEach(async () => {
    await new KvStore(kv).reset();
    kv.close();
  });

  describe('GET /:id', () => {
    it('should fetch a message by id', async () => {
      // Create a test message
      const message: z.infer<typeof MessageSchema> = {
        id: 'msg_test1',
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'CREATED',
        created_at: new Date(),
        updated_at: new Date(),
      };

      await messageStore.create(message);

      // Make request
      const req = new Request(`http://localhost/${VERSION_STRING}/messages/msg_test1`);
      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      const validate = MessageSchema.safeParse(body);

      assertEquals(validate.success, true, `Invalid response body: ${JSON.stringify(body)}`);
      assertExists(validate.data, `Missing message data`);
      assertEquals(validate.data.id, message.id);
      assertEquals(validate.data.status, message.status);
    });

    it('should return 404 for non-existent message', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/messages/non_existent`);
      const res = await app.fetch(req);
      assertEquals(res.status, 404);
    });
  });

  describe('GET /by-status/:status', () => {
    it('should fetch messages by status', async () => {
      // Create test messages
      const message1: z.infer<typeof MessageSchema> = {
        id: 'msg_test1',
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'QUEUED',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const message2: z.infer<typeof MessageSchema> = {
        id: 'msg_test2',
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'QUEUED',
        created_at: new Date(),
        updated_at: new Date(),
      };

      await messageStore.create(message1);
      await messageStore.create(message2);

      // Make request
      const req = new Request(`http://localhost/${VERSION_STRING}/messages/by-status/queued`);
      const res = await app.fetch(req);
      assertEquals(res.status, 200);

      const body = await res.json();
      const validate = z.array(MessageSchema).safeParse(body);

      assertEquals(validate.success, true, `Invalid response body: ${JSON.stringify(body)}`);
      assertExists(validate.data, `Missing message data`);
      assertEquals(validate.data.length, 2);
      assertEquals(validate.data[0].status, 'QUEUED');
      assertEquals(validate.data[1].status, 'QUEUED');
    });

    it('should return 400 for invalid status', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/messages/by-status/invalid`);
      const res = await app.fetch(req);
      assertEquals(res.status, 400);
    });
  });

  describe('POST /:url', () => {
    it('should create a new message', async () => {
      const payload = { test: true };
      const req = new Request(`http://localhost/${VERSION_STRING}/messages/https://example.com/callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 201);

      const body = await res.json();
      const validate = MessageReceivedResponseSchema.safeParse(body);
      assertEquals(validate.success, true, `Invalid response body: ${JSON.stringify(body)}`);
      assertExists(validate.data);
      assertExists(validate.data.id);
      assertExists(validate.data.publish_at);
      assertEquals(validate.data.id.startsWith('msg_'), true);
    });

    it('should create a new message with delayed publish date', async () => {
      const payload = { test: true };
      const req = new Request(`http://localhost/${VERSION_STRING}/messages/https://example.com/callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Done-Delay': '5s',
        },
        body: JSON.stringify(payload),
      });

      const res = await app.fetch(req);
      assertEquals(res.status, 201);

      const body = await res.json();
      assertExists(body.id);
      assertExists(body.publishAt);

      // Verify the publish date is in the future
      const publishAt = new Date(body.publishAt);
      const now = new Date();
      assertEquals(publishAt > now, true);
    });
  });
});
