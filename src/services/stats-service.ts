import { Client } from 'libsql-core';

export interface StatsData {
  total: number;
  byStatus: Record<string, number>;
  last24h: number;
  last7d: number;
  hourlyActivity: number[];
  dailyTrend: Array<{
    date: string;
    incoming: number;
    sent: number;
  }>;
}

export class StatsService {
  private statsKey = ['stats', 'messages'];

  constructor(
    private storage: { kv?: Deno.Kv; sqlite?: Client },
  ) {}

  async incrementStatus(status: string, timestamp: Date = new Date()) {
    if (this.storage.kv) {
      await this.incrementKvStats(status, timestamp);
    } else if (this.storage.sqlite) {
      await this.incrementSqliteStats(status, timestamp);
    }
  }

  async decrementStatus(status: string, timestamp: Date = new Date()) {
    if (this.storage.kv) {
      await this.decrementKvStats(status, timestamp);
    } else if (this.storage.sqlite) {
      await this.decrementSqliteStats(status, timestamp);
    }
  }

  async getStats(): Promise<StatsData> {
    if (this.storage.kv) {
      return await this.getKvStats();
    } else if (this.storage.sqlite) {
      return await this.getSqliteStats();
    }

    return this.getEmptyStats();
  }

  private async incrementKvStats(status: string, timestamp: Date) {
    const hour = timestamp.getHours();
    const date = timestamp.toISOString().split('T')[0];
    const kv = this.storage.kv!;

    // Get current values
    const statusEntry = await kv.get([...this.statsKey, 'status', status]);
    const hourlyEntry = await kv.get([...this.statsKey, 'hourly', hour]);
    const dailyEntry = await kv.get([...this.statsKey, 'daily', date, 'incoming']);

    const statusValue = Number(statusEntry.value || 0);
    const hourlyValue = Number(hourlyEntry.value || 0);
    const dailyValue = Number(dailyEntry.value || 0);

    // Use atomic operations for consistency
    const atomicOp = kv.atomic()
      .set([...this.statsKey, 'status', status], statusValue + 1)
      .set([...this.statsKey, 'hourly', hour], hourlyValue + 1)
      .set([...this.statsKey, 'daily', date, 'incoming'], dailyValue + 1);

    // Only increment total for CREATED status (new messages)
    if (status === 'CREATED') {
      const totalEntry = await kv.get([...this.statsKey, 'total']);
      const totalValue = Number(totalEntry.value || 0);
      atomicOp.set([...this.statsKey, 'total'], totalValue + 1);
    }

    await atomicOp.commit();
  }

  private async decrementKvStats(status: string, timestamp: Date) {
    const hour = timestamp.getHours();
    const date = timestamp.toISOString().split('T')[0];
    const kv = this.storage.kv!;

    // Get current values
    const statusEntry = await kv.get([...this.statsKey, 'status', status]);
    const hourlyEntry = await kv.get([...this.statsKey, 'hourly', hour]);
    const dailyEntry = await kv.get([...this.statsKey, 'daily', date, 'incoming']);

    const statusValue = Number(statusEntry.value || 0);
    const hourlyValue = Number(hourlyEntry.value || 0);
    const dailyValue = Number(dailyEntry.value || 0);

    // Set new values (ensure they don't go below 0)
    const atomicOp = kv.atomic()
      .set([...this.statsKey, 'status', status], Math.max(0, statusValue - 1))
      .set([...this.statsKey, 'hourly', hour], Math.max(0, hourlyValue - 1))
      .set([...this.statsKey, 'daily', date, 'incoming'], Math.max(0, dailyValue - 1));

    // Never decrement total - it represents all messages ever created

    await atomicOp.commit();
  }

  private async getKvStats(): Promise<StatsData> {
    const kv = this.storage.kv!;

    // Get total
    const totalEntry = await kv.get([...this.statsKey, 'total']);
    const total = Number(totalEntry.value || 0);

    // Get status counts
    const byStatus: Record<string, number> = {};
    const statuses = ['CREATED', 'QUEUED', 'DELIVER', 'SENT', 'RETRY', 'DLQ', 'ARCHIVED', 'FAILED'];

    for (const status of statuses) {
      const entry = await kv.get([...this.statsKey, 'status', status]);
      byStatus[status] = Number(entry.value || 0);
    }

    // Get hourly activity
    const hourlyActivity = [];
    for (let hour = 0; hour < 24; hour++) {
      const entry = await kv.get([...this.statsKey, 'hourly', hour]);
      hourlyActivity.push(Number(entry.value || 0));
    }

    // Get daily trend for last 7 days
    const dailyTrend = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const incomingEntry = await kv.get([...this.statsKey, 'daily', dateStr, 'incoming']);
      const sentEntry = await kv.get([...this.statsKey, 'daily', dateStr, 'sent']);

      dailyTrend.push({
        date: dateStr,
        incoming: Number(incomingEntry.value || 0),
        sent: Number(sentEntry.value || 0),
      });
    }

    // Calculate last 24h and 7d from daily data
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let last24h = 0;
    let last7d = 0;

    for (const day of dailyTrend) {
      const dayDate = new Date(day.date);
      if (dayDate >= yesterday) last24h += day.incoming;
      if (dayDate >= weekAgo) last7d += day.incoming;
    }

    return {
      total,
      byStatus,
      last24h,
      last7d,
      hourlyActivity,
      dailyTrend,
    };
  }

  private async incrementSqliteStats(status: string, timestamp: Date) {
    const hour = timestamp.getHours();
    const date = timestamp.toISOString().split('T')[0];

    // Use a stats table for SQLite
    await this.storage.sqlite!.execute({
      sql: `
        INSERT INTO message_stats (date, hour, status, count) 
        VALUES (?, ?, ?, 1)
        ON CONFLICT(date, hour, status) 
        DO UPDATE SET count = count + 1
      `,
      args: [date, hour, status],
    });
  }

  private async decrementSqliteStats(status: string, timestamp: Date) {
    const hour = timestamp.getHours();
    const date = timestamp.toISOString().split('T')[0];

    await this.storage.sqlite!.execute({
      sql: `
        UPDATE message_stats 
        SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END
        WHERE date = ? AND hour = ? AND status = ?
      `,
      args: [date, hour, status],
    });
  }

  private async getSqliteStats(): Promise<StatsData> {
    // Get total count from actual messages table for accuracy
    const totalResult = await this.storage.sqlite!.execute(
      `SELECT COUNT(*) as total FROM messages`,
    );
    const total = Number(totalResult.rows[0]?.total || 0);

    // Get counts by status
    const statusResult = await this.storage.sqlite!.execute(`
      SELECT status, SUM(count) as count 
      FROM message_stats 
      GROUP BY status
    `);

    const byStatus: Record<string, number> = {};
    for (const row of statusResult.rows) {
      byStatus[row.status as string] = Number(row.count);
    }

    // Get hourly activity
    const hourlyResult = await this.storage.sqlite!.execute(`
      SELECT hour, SUM(count) as count
      FROM message_stats
      WHERE date >= date('now', '-7 days')
      GROUP BY hour
      ORDER BY hour
    `);

    const hourlyActivity = Array(24).fill(0);
    for (const row of hourlyResult.rows) {
      hourlyActivity[row.hour as number] = Number(row.count);
    }

    // Get daily trend
    const trendResult = await this.storage.sqlite!.execute(`
      SELECT 
        date,
        SUM(count) as incoming,
        SUM(CASE WHEN status = 'SENT' THEN count ELSE 0 END) as sent
      FROM message_stats
      WHERE date >= date('now', '-7 days')
      GROUP BY date
      ORDER BY date
    `);

    const dailyTrend = trendResult.rows.map((row) => ({
      date: row.date as string,
      incoming: Number(row.incoming),
      sent: Number(row.sent),
    }));

    // Get last 24h and 7d
    const last24hResult = await this.storage.sqlite!.execute(`
      SELECT COALESCE(SUM(count), 0) as count
      FROM message_stats
      WHERE datetime(date || ' ' || printf('%02d:00:00', hour)) >= datetime('now', '-1 day')
    `);

    const last7dResult = await this.storage.sqlite!.execute(`
      SELECT COALESCE(SUM(count), 0) as count
      FROM message_stats
      WHERE date >= date('now', '-7 days')
    `);

    return {
      total,
      byStatus,
      last24h: Number(last24hResult.rows[0]?.count || 0),
      last7d: Number(last7dResult.rows[0]?.count || 0),
      hourlyActivity,
      dailyTrend,
    };
  }

  private getEmptyStats(): StatsData {
    return {
      total: 0,
      byStatus: {},
      last24h: 0,
      last7d: 0,
      hourlyActivity: Array(24).fill(0),
      dailyTrend: [],
    };
  }

  // Initialize stats from existing messages
  async initializeFromMessages(messages: Array<{ status: string; publish_at: Date }>) {
    if (this.storage.kv) {
      await this.initializeKvStats(messages);
    } else if (this.storage.sqlite) {
      await this.initializeSqliteStats(messages);
    }
  }

  private async initializeKvStats(messages: Array<{ status: string; publish_at: Date }>) {
    // Reset all stats first
    const entries = this.storage.kv!.list({ prefix: ['stats', 'messages'] });
    for await (const entry of entries) {
      await this.storage.kv!.delete(entry.key);
    }

    // Group messages by date, hour, and status for batch processing
    const statusCounts: Record<string, number> = {};
    const dailyCounts: Record<string, Record<string, number>> = {};
    const hourlyCounts: Record<number, number> = {};

    for (const msg of messages) {
      const date = msg.publish_at.toISOString().split('T')[0];
      const hour = msg.publish_at.getHours();

      // Count by status
      statusCounts[msg.status] = (statusCounts[msg.status] || 0) + 1;

      // Count by date
      if (!dailyCounts[date]) {
        dailyCounts[date] = { incoming: 0 };
      }
      dailyCounts[date].incoming++;
      if (msg.status === 'SENT') {
        dailyCounts[date].sent = (dailyCounts[date].sent || 0) + 1;
      }

      // Count by hour
      hourlyCounts[hour] = (hourlyCounts[hour] || 0) + 1;
    }

    // Write all stats in one atomic operation
    let atomic = this.storage.kv!.atomic();

    // Total count
    atomic = atomic.set(['stats', 'messages', 'total'], BigInt(messages.length));

    // Status counts
    for (const [status, count] of Object.entries(statusCounts)) {
      atomic = atomic.set(['stats', 'messages', 'status', status], BigInt(count));
    }

    // Daily counts
    for (const [date, counts] of Object.entries(dailyCounts)) {
      atomic = atomic.set(['stats', 'messages', 'daily', date, 'incoming'], BigInt(counts.incoming));
      if (counts.sent) {
        atomic = atomic.set(['stats', 'messages', 'daily', date, 'sent'], BigInt(counts.sent));
      }
    }

    // Hourly counts
    for (const [hour, count] of Object.entries(hourlyCounts)) {
      atomic = atomic.set(['stats', 'messages', 'hourly', Number(hour)], BigInt(count));
    }

    await atomic.commit();
  }

  private async initializeSqliteStats(messages: Array<{ status: string; publish_at: Date }>) {
    // Clear existing stats
    await this.storage.sqlite!.execute('DELETE FROM message_stats');

    // Group messages for batch insert
    const statsMap = new Map<string, number>();

    for (const msg of messages) {
      const date = msg.publish_at.toISOString().split('T')[0];
      const hour = msg.publish_at.getHours();
      const key = `${date}|${hour}|${msg.status}`;

      statsMap.set(key, (statsMap.get(key) || 0) + 1);
    }

    // Batch insert stats
    for (const [key, count] of statsMap) {
      const [date, hour, status] = key.split('|');
      await this.storage.sqlite!.execute({
        sql: 'INSERT INTO message_stats (date, hour, status, count) VALUES (?, ?, ?, ?)',
        args: [date, parseInt(hour), status, count],
      });
    }
  }

  // Cleanup old stats data (run periodically)
  async cleanupOldStats(daysToKeep: number = 30) {
    if (this.storage.sqlite) {
      await this.storage.sqlite.execute({
        sql: 'DELETE FROM message_stats WHERE date < date("now", ? || " days")',
        args: [-daysToKeep],
      });
    } else if (this.storage.kv) {
      // For KV, we'd need to iterate and delete old daily entries
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      // This would need to be implemented based on your KV structure
    }
  }
}
