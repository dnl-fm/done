import { assertEquals, assertExists } from 'jsr:@std/assert';
import { afterEach, beforeEach, describe, it } from 'jsr:@std/testing/bdd';
import { MessageData, MessageModel, MessageReceivedData } from '../../src/stores/kv/kv-message-model.ts';
import { KvMessagesStore } from '../../src/stores/kv/kv-messages-store.ts';
import { KvUtilStore } from '../../src/stores/kv/kv-util-store.ts';
import { Dates } from '../../src/utils/dates.ts';

describe('KvMessagesStore integration tests', () => {
  let store: KvMessagesStore;
  let kv: Deno.Kv;

  beforeEach(async () => {
    kv = await Deno.openKv();
    store = new KvMessagesStore(kv);
  });

  afterEach(async () => {
    await new KvUtilStore(kv).reset();
    kv.close();
  });

  describe('create()', () => {
    it('should create a new message', async () => {
      const message: MessageData = {
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
          data: { test: true },
        },
        publish_at: new Date(),
        status: 'CREATED',
      };

      const result = await store.create(message);
      assertEquals(result.isOk(), true, 'should create a new message');

      if (result.isOk()) {
        const created = result.value;
        assertEquals(created.status, message.status, 'should have the correct status');
        assertExists(created.created_at, 'should have a created_at');
        assertEquals(created.id.startsWith('msg_'), true, 'should have a valid id');
      }
    });

    it('should create a new message with a custom id', async () => {
      const message: MessageData = {
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
          data: { test: true },
        },
        publish_at: new Date(),
        status: 'CREATED',
      };

      const result = await store.create(message, { withId: 'msg_test1' });
      assertEquals(result.isOk(), true, 'should create a new message');

      if (result.isOk()) {
        const created = result.value;
        assertEquals(created.status, message.status, 'should have the correct status');
        assertExists(created.created_at, 'should have a created_at');
        assertEquals(created.id, 'msg_test1', 'should have the correct id');
      }
    });
  });

  describe('fetch()', () => {
    it('should fetch a message by id', async () => {
      const message: MessageData = {
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'CREATED',
      };

      const createResult = await store.create(message);
      assertEquals(createResult.isOk(), true);

      const result = await store.fetchOne(createResult.value.id);
      assertEquals(result.isOk(), true);

      if (result.isOk()) {
        assertEquals(result.value.id, createResult.value.id);
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
      const message1: MessageData = {
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'QUEUED',
      };

      const message2: MessageData = {
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'ARCHIVED',
      };

      const createResult1 = await store.create(message1);
      assertEquals(createResult1.isOk(), true);

      const createResult2 = await store.create(message2);
      assertEquals(createResult2.isOk(), true);

      const result = await store.fetchByStatus('QUEUED');
      assertEquals(result.isOk(), true);

      if (result.isOk()) {
        assertEquals(result.value.length, 1, 'should fetch 1 message');
        assertEquals(result.value[0].id, createResult1.value.id, 'should have the correct id for the first message');
        assertEquals(result.value[0].status, 'QUEUED', 'should have the correct status for the first message');
      }
    });
  });

  describe('fetchByDate()', () => {
    it('should fetch messages by publish_at', async () => {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const message1: MessageData = {
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: today,
        status: 'CREATED',
      };

      const message2: MessageData = {
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: tomorrow,
        status: 'CREATED',
      };

      await store.create(message1, { withId: 'msg_test5' });
      await store.create(message2, { withId: 'msg_test6' });

      const result = await store.fetchByDate(today);
      assertEquals(result.isOk(), true, 'should fetch messages by publish_at');

      if (result.isOk()) {
        assertEquals(result.value.length, 1);
        assertEquals(Dates.getDateOnly(result.value[0].publish_at), Dates.getDateOnly(today));
      }
    });
  });

  describe('update()', () => {
    it('should update a message', async () => {
      const message: MessageData = {
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'CREATED',
      };

      const createResult = await store.create(message);
      assertEquals(createResult.isOk(), true);

      const updateResult = await store.update(createResult.value.id, {
        payload: message.payload,
        publish_at: message.publish_at,
        status: 'QUEUED',
      });

      assertEquals(updateResult.isOk(), true);

      if (updateResult.isOk()) {
        assertEquals(updateResult.value.status, 'QUEUED');
      }
    });
  });

  describe('delete()', () => {
    it('should delete a message', async () => {
      const message: MessageData = {
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: new Date(),
        status: 'CREATED',
      };

      const createResult = await store.create(message, { withId: 'msg_test8' });
      assertEquals(createResult.isOk(), true);

      const deleteResult = await store.delete(createResult.value.id);
      assertEquals(deleteResult.isOk(), true);

      const fetchResult = await store.fetchOne(createResult.value.id);
      assertEquals(fetchResult.isErr(), true);
    });
  });

  describe('createFromReceivedData()', () => {
    it('should create a message from received data', async () => {
      const receivedData: MessageReceivedData = {
        id: 'msg_test9',
        payload: {
          headers: {
            forward: {},
            command: {},
          },
          url: 'https://example.com',
        },
        publish_at: new Date(),
      };

      const result = await store.createFromReceivedData(receivedData);
      assertEquals(result.isOk(), true);

      if (result.isOk()) {
        const created = result.value as unknown as MessageModel;
        assertEquals(created.id, receivedData.id);
        assertEquals(created.status, 'CREATED');
        assertEquals(created.payload, receivedData.payload);
      }
    });
  });
});
