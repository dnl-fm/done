import { assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { afterEach, beforeEach, describe, it } from 'https://deno.land/std@0.210.0/testing/bdd.ts';
import { StatsService } from '../../src/services/stats-service.ts';
import { SqliteStore } from '../../src/services/storage/sqlite-store.ts';
import { MESSAGE_STATUS } from '../../src/stores/kv/kv-message-model.ts';
import { Client } from 'libsql-core';

describe('StatsService', () => {
  describe('KV Storage', () => {
    let kv: Deno.Kv;
    let statsService: StatsService;

    beforeEach(async () => {
      kv = await Deno.openKv(':memory:');
      statsService = new StatsService({ kv });
    });

    afterEach(async () => {
      await kv.close();
    });

    it('should track total messages only when CREATED status is incremented', async () => {
      const timestamp = new Date();

      // Create 3 messages
      await statsService.incrementStatus('CREATED', timestamp);
      await statsService.incrementStatus('CREATED', timestamp);
      await statsService.incrementStatus('CREATED', timestamp);

      let stats = await statsService.getStats();
      assertEquals(stats.total, 3);
      assertEquals(stats.byStatus['CREATED'], 3);

      // Transition one message from CREATED to SENT
      await statsService.decrementStatus('CREATED', timestamp);
      await statsService.incrementStatus('SENT', timestamp);

      stats = await statsService.getStats();
      assertEquals(stats.total, 3, 'Total should remain 3');
      assertEquals(stats.byStatus['CREATED'], 2);
      assertEquals(stats.byStatus['SENT'], 1);
    });

    it('should track hourly activity', async () => {
      const morning = new Date('2024-01-01T09:30:00');
      const afternoon = new Date('2024-01-01T14:30:00');

      await statsService.incrementStatus('CREATED', morning);
      await statsService.incrementStatus('CREATED', morning);
      await statsService.incrementStatus('CREATED', afternoon);

      const stats = await statsService.getStats();
      assertEquals(stats.hourlyActivity[9], 2);
      assertEquals(stats.hourlyActivity[14], 1);
    });

    it('should handle status transitions correctly', async () => {
      const timestamp = new Date();

      // Create a message
      await statsService.incrementStatus('CREATED', timestamp);

      // Transition through statuses
      await statsService.decrementStatus('CREATED', timestamp);
      await statsService.incrementStatus('QUEUED', timestamp);

      await statsService.decrementStatus('QUEUED', timestamp);
      await statsService.incrementStatus('DELIVER', timestamp);

      await statsService.decrementStatus('DELIVER', timestamp);
      await statsService.incrementStatus('SENT', timestamp);

      const stats = await statsService.getStats();
      assertEquals(stats.total, 1, 'Total should remain 1');
      assertEquals(stats.byStatus['CREATED'], 0);
      assertEquals(stats.byStatus['QUEUED'], 0);
      assertEquals(stats.byStatus['DELIVER'], 0);
      assertEquals(stats.byStatus['SENT'], 1);
    });
  });

  describe('SQLite Storage', () => {
    let sqliteStore: SqliteStore;
    let sqlite: Client;
    let statsService: StatsService;

    beforeEach(async () => {
      // Use in-memory SQLite for tests
      sqliteStore = new SqliteStore({ url: ':memory:' });
      sqlite = await sqliteStore.getClient();

      // Create tables
      await sqlite.execute(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          publish_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);

      await sqlite.execute(`
        CREATE TABLE IF NOT EXISTS message_stats (
          date TEXT NOT NULL,
          hour INTEGER NOT NULL CHECK (hour >= 0 AND hour < 24),
          status TEXT NOT NULL,
          count INTEGER DEFAULT 0,
          PRIMARY KEY (date, hour, status)
        )
      `);

      statsService = new StatsService({ sqlite });
    });

    afterEach(() => {
      // SqliteStore doesn't have a close method
      // The connection is managed internally
    });

    it('should get total from messages table, not stats', async () => {
      const timestamp = new Date();

      // Insert messages directly into messages table
      await sqlite.execute(
        `INSERT INTO messages (id, status, publish_at, created_at) VALUES (?, ?, ?, ?)`,
        ['msg1', 'SENT', timestamp.toISOString(), timestamp.toISOString()],
      );
      await sqlite.execute(
        `INSERT INTO messages (id, status, publish_at, created_at) VALUES (?, ?, ?, ?)`,
        ['msg2', 'SENT', timestamp.toISOString(), timestamp.toISOString()],
      );
      await sqlite.execute(
        `INSERT INTO messages (id, status, publish_at, created_at) VALUES (?, ?, ?, ?)`,
        ['msg3', 'QUEUED', timestamp.toISOString(), timestamp.toISOString()],
      );

      // Track some stats (these might not match actual messages)
      await statsService.incrementStatus('SENT', timestamp);
      await statsService.incrementStatus('SENT', timestamp);
      await statsService.incrementStatus('QUEUED', timestamp);

      const stats = await statsService.getStats();
      assertEquals(stats.total, 3, 'Total should come from messages table');
      assertEquals(stats.byStatus['SENT'], 2);
      assertEquals(stats.byStatus['QUEUED'], 1);
    });

    it('should not create SENT_DAILY entries', async () => {
      const timestamp = new Date();

      // This should only create SENT entries, not SENT_DAILY
      await statsService.incrementStatus('SENT', timestamp);

      const result = await sqlite.execute(
        `SELECT * FROM message_stats WHERE status = 'SENT_DAILY'`,
      );

      assertEquals(result.rows.length, 0, 'Should not have any SENT_DAILY entries');
    });

    it('should track stats by date and hour', async () => {
      const date1 = new Date('2024-01-01T10:00:00');
      const date2 = new Date('2024-01-02T10:00:00');

      await statsService.incrementStatus('CREATED', date1);
      await statsService.incrementStatus('CREATED', date1);
      await statsService.incrementStatus('CREATED', date2);

      const result = await sqlite.execute(
        `SELECT date, hour, status, count FROM message_stats ORDER BY date, hour`,
      );

      assertEquals(result.rows.length, 2);
      // SQLite returns rows as arrays
      const row1 = result.rows[0];
      const row2 = result.rows[1];
      assertEquals([row1[0], row1[1], row1[2], row1[3]], ['2024-01-01', 10, 'CREATED', 2]);
      assertEquals([row2[0], row2[1], row2[2], row2[3]], ['2024-01-02', 10, 'CREATED', 1]);
    });
  });

  describe('Stats Initialization', () => {
    it('should initialize stats from existing messages', async () => {
      const kv = await Deno.openKv(':memory:');
      const statsService = new StatsService({ kv });

      const messages = [
        { status: 'CREATED' as MESSAGE_STATUS, publish_at: new Date('2024-01-01T10:00:00') },
        { status: 'SENT' as MESSAGE_STATUS, publish_at: new Date('2024-01-01T11:00:00') },
        { status: 'SENT' as MESSAGE_STATUS, publish_at: new Date('2024-01-01T11:30:00') },
        { status: 'FAILED' as MESSAGE_STATUS, publish_at: new Date('2024-01-01T12:00:00') },
      ];

      await statsService.initializeFromMessages(messages);

      const stats = await statsService.getStats();
      assertEquals(stats.byStatus['CREATED'], 1);
      assertEquals(stats.byStatus['SENT'], 2);
      assertEquals(stats.byStatus['FAILED'], 1);

      await kv.close();
    });
  });
});
