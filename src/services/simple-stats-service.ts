export class SimpleStatsService {
  constructor(private kv: Deno.Kv) {}

  // When a message is created
  async onMessageCreated(status: string, timestamp: Date = new Date()) {
    const hour = timestamp.getHours();
    const date = timestamp.toISOString().split('T')[0];

    await this.kv.atomic()
      // Increment total count
      .sum(['stats', 'total'], 1n)
      // Increment status count
      .sum(['stats', 'status', status], 1n)
      // Increment hourly count for today
      .sum(['stats', 'hourly', hour], 1n)
      // Increment daily incoming count
      .sum(['stats', 'daily', date, 'total'], 1n)
      .commit();
  }

  // When a message status changes (e.g., CREATED -> SENT)
  async onMessageStatusChanged(oldStatus: string, newStatus: string) {
    await this.kv.atomic()
      // Decrement old status
      .sum(['stats', 'status', oldStatus], -1n)
      // Increment new status
      .sum(['stats', 'status', newStatus], 1n)
      // If changed to SENT, increment sent count for today
      .sum(['stats', 'daily', new Date().toISOString().split('T')[0], 'sent'], newStatus === 'SENT' ? 1n : 0n)
      .commit();
  }

  // When a message is deleted
  async onMessageDeleted(status: string) {
    await this.kv.atomic()
      .sum(['stats', 'total'], -1n)
      .sum(['stats', 'status', status], -1n)
      .commit();
  }

  // Get current stats (super fast - just reading counters)
  async getStats() {
    // Read all counters
    const total = await this.kv.get<bigint>(['stats', 'total']);

    // Get status counts
    const statuses = ['CREATED', 'QUEUED', 'DELIVER', 'SENT', 'RETRY', 'DLQ', 'ARCHIVED'];
    const statusCounts: Record<string, number> = {};

    for (const status of statuses) {
      const count = await this.kv.get<bigint>(['stats', 'status', status]);
      statusCounts[status] = Number(count.value || 0n);
    }

    // Get last 7 days trend
    const trend7d = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const dailyTotal = await this.kv.get<bigint>(['stats', 'daily', dateStr, 'total']);
      const dailySent = await this.kv.get<bigint>(['stats', 'daily', dateStr, 'sent']);

      trend7d.push({
        date: dateStr,
        incoming: Number(dailyTotal.value || 0n),
        sent: Number(dailySent.value || 0n),
      });
    }

    // Get hourly activity (for today)
    const hourlyActivity = [];
    for (let hour = 0; hour < 24; hour++) {
      const count = await this.kv.get<bigint>(['stats', 'hourly', hour]);
      hourlyActivity.push(Number(count.value || 0n));
    }

    return {
      total: Number(total.value || 0n),
      statusCounts,
      trend7d,
      hourlyActivity,
      // Calculate these from daily data
      last24h: trend7d[6]?.incoming || 0, // Today's count
      last7d: trend7d.reduce((sum, day) => sum + day.incoming, 0),
    };
  }

  // Cleanup job - reset hourly counters at midnight
  async resetDailyCounters() {
    const tx = this.kv.atomic();

    // Reset all hourly counters
    for (let hour = 0; hour < 24; hour++) {
      tx.set(['stats', 'hourly', hour], 0n);
    }

    await tx.commit();
  }
}
