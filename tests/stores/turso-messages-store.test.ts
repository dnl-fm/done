import { assertEquals, assertExists } from 'jsr:@std/assert';
import { beforeEach, describe, it } from 'jsr:@std/testing/bdd';
import { Client } from 'libsql-core';
import { SqliteStore } from '../../src/services/storage/sqlite-store.ts';
import { MESSAGE_STATUS, MessageModel } from '../../src/stores/kv-message-model.ts';
import { TursoMessagesStore } from '../../src/stores/turso-messages-store.ts';
import { Dates } from '../../src/utils/dates.ts';
import { Migrations } from '../../src/utils/migrations.ts';

describe('TursoMessagesStore integration tests', () => {
  let client: Client;
  let store: TursoMessagesStore;
  let sqliteStore: SqliteStore;

  beforeEach(async () => {
    sqliteStore = new SqliteStore({ url: ':memory:' });
    client = await sqliteStore.getClient();

    await new Migrations(sqliteStore).migrate({ force: true });
    store = new TursoMessagesStore(client);
  });

  describe('create()', () => {
    it('should create a new message', async () => {
      const message: MessageModel = {
        id: 'msg_test1',
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
          data: { test: true },
        },
        publish_at: new Date(),
        status: 'CREATED' as MESSAGE_STATUS,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const result = await store.create(message);
      assertEquals(result.isOk(), true);

      if (result.isOk()) {
        assertEquals(result.value.id, message.id);
        assertEquals(result.value.status, message.status);
        assertExists(result.value.created_at);
      }
    });
  });

  describe('fetch()', () => {
    it('should fetch a message by id', async () => {
      const message: MessageModel = {
        id: 'msg_test2',
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'CREATED' as MESSAGE_STATUS,
        created_at: new Date(),
        updated_at: new Date(),
      };

      await store.create(message);
      const result = await store.fetchOne(message.id);

      assertEquals(result.isOk(), true);
      if (result.isOk()) {
        assertEquals(result.value.id, message.id);
        assertEquals(result.value.status, message.status);
      }
    });

    it('should return error for non-existent message', async () => {
      const result = await store.fetchOne('non_existent');
      assertEquals(result.isErr(), true);
    });
  });

  describe('fetchByStatus()', () => {
    it('should fetch messages by status', async () => {
      const message1: MessageModel = {
        id: 'msg_test3',
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'QUEUED' as MESSAGE_STATUS,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const message2: MessageModel = {
        id: 'msg_test4',
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'QUEUED' as MESSAGE_STATUS,
        created_at: new Date(),
        updated_at: new Date(),
      };

      await store.create(message1);
      await store.create(message2);

      const result = await store.fetchByStatus('QUEUED');
      assertEquals(result.isOk(), true);
      if (result.isOk()) {
        assertEquals(result.value.length, 2);
        assertEquals(result.value[0].status, 'QUEUED');
      }
    });
  });

  describe('fetchByDate()', () => {
    it('should fetch messages by publish date', async () => {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const message1: MessageModel = {
        id: 'msg_test5',
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: today,
        status: 'CREATED' as MESSAGE_STATUS,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const message2: MessageModel = {
        id: 'msg_test6',
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: tomorrow,
        status: 'CREATED' as MESSAGE_STATUS,
        created_at: new Date(),
        updated_at: new Date(),
      };

      await store.create(message1);
      await store.create(message2);

      const result = await store.fetchByDate(today);
      assertEquals(result.isOk(), true);
      if (result.isOk()) {
        assertEquals(result.value.length, 1);
        assertEquals(Dates.getDateOnly(result.value[0].publish_at), Dates.getDateOnly(today));
      }
    });
  });

  describe('update()', () => {
    it('should update a message', async () => {
      const message: MessageModel = {
        id: 'msg_test7',
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'CREATED' as MESSAGE_STATUS,
        created_at: new Date(),
        updated_at: new Date(),
      };

      await store.create(message);

      const updateResult = await store.update(message.id, {
        payload: message.payload,
        publish_at: message.publish_at,
        status: 'QUEUED' as MESSAGE_STATUS,
      });

      assertEquals(updateResult.isOk(), true);
      if (updateResult.isOk()) {
        assertEquals(updateResult.value.status, 'QUEUED');
      }
    });
  });

  describe('delete()', () => {
    it('should delete a message', async () => {
      const message: MessageModel = {
        id: 'msg_test8',
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'CREATED' as MESSAGE_STATUS,
        created_at: new Date(),
        updated_at: new Date(),
      };

      await store.create(message);
      const deleteResult = await store.delete(message.id);
      assertEquals(deleteResult.isOk(), true);

      const fetchResult = await store.fetchOne(message.id);
      assertEquals(fetchResult.isErr(), true);
    });
  });
});
