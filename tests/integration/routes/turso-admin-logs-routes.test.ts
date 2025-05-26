import { afterEach, beforeEach, describe, it } from 'jsr:@std/testing/bdd';
import { expect } from 'jsr:@std/expect';
import { Client } from 'libsql-core';
import { TursoAdminRoutes } from '../../../src/routes/turso-admin-routes.ts';
import { SqliteStore } from '../../../src/services/storage/sqlite-store.ts';
import { TursoMessagesStore } from '../../../src/stores/turso/turso-messages-store.ts';
import { TursoLogsStore } from '../../../src/stores/turso/turso-logs-store.ts';
import { Migrations } from '../../../src/utils/migrations.ts';
import { Routes } from '../../../src/utils/routes.ts';
import { VERSION_STRING } from '../../../src/version.ts';

describe('Turso Admin Logs Routes', () => {
  let sqlite: Client;
  let sqliteStore: SqliteStore;
  let app: ReturnType<typeof Routes.initHono>;
  let messageStore: TursoMessagesStore;
  let logsStore: TursoLogsStore;

  beforeEach(async () => {
    // Set STORAGE_TYPE to TURSO for these tests
    Deno.env.set('STORAGE_TYPE', 'TURSO');
    Deno.env.set('ENABLE_AUTH', 'false');

    // Create in-memory SQLite for testing
    sqliteStore = new SqliteStore({ url: ':memory:' });
    sqlite = await sqliteStore.getClient();

    // Run migrations to set up tables
    await new Migrations(sqliteStore).migrate({ force: true });

    // Create stores directly
    messageStore = new TursoMessagesStore(sqlite);
    logsStore = new TursoLogsStore(sqlite);

    // Create admin routes
    const adminRoutes = new TursoAdminRoutes(messageStore, logsStore, sqlite);

    app = Routes.initHono();
    app.route(`/${VERSION_STRING}/admin`, adminRoutes.getRoutes());
  });

  afterEach(() => {
    Deno.env.delete('STORAGE_TYPE');
    Deno.env.delete('ENABLE_AUTH');
  });

  describe('GET /v1/admin/logs', () => {
    it('should return empty array when no logs exist', async () => {
      const response = await app.request(`/${VERSION_STRING}/admin/logs`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    });

    it('should return logs when they exist', async () => {
      // Create a test message first
      const messageResult = await messageStore.create({
        payload: {
          headers: { forward: {}, command: {} },
          url: 'https://example.com/webhook',
          data: { test: 'data' },
        },
        status: 'CREATED',
        publish_at: new Date(),
        retried: 0,
      });

      if (messageResult.isErr()) throw new Error('Failed to create message');
      const message = messageResult.value;

      // Create logs for the message
      await logsStore.create({
        type: 'CREATE',
        object: 'message',
        message_id: message.id,
        before_data: {},
        after_data: { id: message.id, status: 'CREATED' },
      });

      await logsStore.create({
        type: 'UPDATE',
        object: 'message',
        message_id: message.id,
        before_data: { id: message.id, status: 'CREATED' },
        after_data: { id: message.id, status: 'QUEUED' },
      });

      const response = await app.request(`/${VERSION_STRING}/admin/logs`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);

      // Should be ordered by created_at DESC
      expect(data[0].type).toBe('UPDATE');
      expect(data[1].type).toBe('CREATE');

      // Verify log structure
      expect(data[0]).toMatchObject({
        type: 'UPDATE',
        object: 'message',
        message_id: message.id,
        before_data: { id: message.id, status: 'CREATED' },
        after_data: { id: message.id, status: 'QUEUED' },
      });
    });
  });

  describe('GET /v1/admin/log/:messageId', () => {
    it('should return empty logs array for non-existent message', async () => {
      const response = await app.request(`/${VERSION_STRING}/admin/log/msg_nonexistent`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.messageId).toBe('msg_nonexistent');
      expect(Array.isArray(data.logs)).toBe(true);
      expect(data.logs).toHaveLength(0);
    });

    it('should return logs for a specific message', async () => {
      // Create test message
      const messageResult = await messageStore.create({
        payload: {
          headers: { forward: {}, command: {} },
          url: 'https://example.com/webhook',
          data: { test: 'data' },
        },
        status: 'CREATED',
        publish_at: new Date(),
        retried: 0,
      });

      if (messageResult.isErr()) throw new Error('Failed to create message');
      const message = messageResult.value;

      // Create logs for this message
      await logsStore.create({
        type: 'CREATE',
        object: 'message',
        message_id: message.id,
        before_data: {},
        after_data: { id: message.id, status: 'CREATED' },
      });

      await logsStore.create({
        type: 'UPDATE',
        object: 'message',
        message_id: message.id,
        before_data: { id: message.id, status: 'CREATED' },
        after_data: { id: message.id, status: 'QUEUED' },
      });

      // Create log for a different message (should not be returned)
      const otherMessageResult = await messageStore.create({
        payload: {
          headers: { forward: {}, command: {} },
          url: 'https://other.com/webhook',
          data: { other: 'data' },
        },
        status: 'CREATED',
        publish_at: new Date(),
        retried: 0,
      });

      if (otherMessageResult.isErr()) throw new Error('Failed to create other message');
      const otherMessage = otherMessageResult.value;

      await logsStore.create({
        type: 'CREATE',
        object: 'message',
        message_id: otherMessage.id,
        before_data: {},
        after_data: { id: otherMessage.id, status: 'CREATED' },
      });

      const response = await app.request(`/${VERSION_STRING}/admin/log/${message.id}`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.messageId).toBe(message.id);
      expect(Array.isArray(data.logs)).toBe(true);
      expect(data.logs).toHaveLength(2);

      // Should be ordered by created_at ASC (chronological order)
      expect(data.logs[0].type).toBe('CREATE');
      expect(data.logs[1].type).toBe('UPDATE');

      // Verify only logs for requested message are returned
      data.logs.forEach((log: { message_id: string }) => {
        expect(log.message_id).toBe(message.id);
      });
    });
  });

  describe('DELETE /v1/admin/reset/logs', () => {
    it('should reset only logs table', async () => {
      // Create test message and logs
      const messageResult = await messageStore.create({
        payload: {
          headers: { forward: {}, command: {} },
          url: 'https://example.com/webhook',
          data: { test: 'data' },
        },
        status: 'CREATED',
        publish_at: new Date(),
        retried: 0,
      });

      if (messageResult.isErr()) throw new Error('Failed to create message');
      const message = messageResult.value;

      await logsStore.create({
        type: 'CREATE',
        object: 'message',
        message_id: message.id,
        before_data: {},
        after_data: { id: message.id, status: 'CREATED' },
      });

      // Verify logs exist
      let logsResponse = await app.request(`/${VERSION_STRING}/admin/logs`);
      let logsData = await logsResponse.json();
      expect(logsData).toHaveLength(1);

      // Reset logs
      const resetResponse = await app.request(`/${VERSION_STRING}/admin/reset/logs`, {
        method: 'DELETE',
      });
      expect(resetResponse.status).toBe(200);

      const resetData = await resetResponse.json();
      expect(resetData.message).toBe('Logs table reset!');
      expect(resetData.match).toBe('logs');

      // Verify logs are gone but message still exists
      logsResponse = await app.request(`/${VERSION_STRING}/admin/logs`);
      logsData = await logsResponse.json();
      expect(logsData).toHaveLength(0);

      const messageResponse = await messageStore.fetchOne(message.id);
      expect(messageResponse.isOk()).toBe(true);
    });
  });

  describe('DELETE /v1/admin/reset (all)', () => {
    it('should reset both messages and logs tables', async () => {
      // Create test message and logs
      const messageResult = await messageStore.create({
        payload: {
          headers: { forward: {}, command: {} },
          url: 'https://example.com/webhook',
          data: { test: 'data' },
        },
        status: 'CREATED',
        publish_at: new Date(),
        retried: 0,
      });

      if (messageResult.isErr()) throw new Error('Failed to create message');
      const message = messageResult.value;

      await logsStore.create({
        type: 'CREATE',
        object: 'message',
        message_id: message.id,
        before_data: {},
        after_data: { id: message.id, status: 'CREATED' },
      });

      // Reset all
      const resetResponse = await app.request(`/${VERSION_STRING}/admin/reset`, {
        method: 'DELETE',
      });
      expect(resetResponse.status).toBe(200);

      const resetData = await resetResponse.json();
      expect(resetData.message).toBe('Messages and logs tables reset!');
      expect(resetData.match).toBe('all');

      // Verify both are gone
      const logsResponse = await app.request(`/${VERSION_STRING}/admin/logs`);
      const logsData = await logsResponse.json();
      expect(logsData).toHaveLength(0);

      const messageResponse = await messageStore.fetchOne(message.id);
      expect(messageResponse.isErr()).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      // Close the database connection to simulate error
      sqlite.close();

      const response = await app.request(`/${VERSION_STRING}/admin/logs`);
      expect(response.status).toBe(500);

      const data = await response.json();
      expect(data.error).toBe('Failed to retrieve logs');
    });
  });
});
