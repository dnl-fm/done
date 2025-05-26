/**
 * Client for interacting with the Done message queue API
 */
export class StoreClient {
  private baseUrl: string;
  private authToken: string;
  private version: string = 'v1';

  constructor() {
    // Use environment variables or default values
    this.baseUrl = Deno.env.get('DONE_API_URL') || 'http://localhost:3001';
    this.authToken = Deno.env.get('AUTH_TOKEN') || '';
  }

  /**
   * Make authenticated API request
   */
  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}/${this.version}${path}`;
    const headers = {
      'Authorization': `Bearer ${this.authToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    return await fetch(url, {
      ...options,
      headers,
    });
  }

  /**
   * Get overall message statistics
   */
  async getStats(): Promise<{
    total: number;
    sent: number;
    failed: number;
    dlq: number;
    created: number;
    queued: number;
    delivered: number;
    deliver: number;
    retry: number;
    archived: number;
    last24h: number;
    last7d: number;
    hourlyActivity: Array<{ hour: string; count: number }>;
    dailyTrend: Array<{ date: string; delivered: number; failed: number }>;
    trend7d: Array<{ date: string; incoming: number; sent: number }>;
    storageType: string;
    hourlyStateChanges?: Array<{
      hour: number;
      created: number;
      queued: number;
      delivering: number;
      sent: number;
      retry: number;
      failed: number;
      dlq: number;
    }>;
  }> {
    const response = await this.fetch('/admin/stats');
    if (!response.ok) {
      throw new Error(`Failed to fetch stats: ${response.status}`);
    }

    const data = await response.json();

    // Transform the API response to match dashboard expectations
    const stats = data.stats || {};

    // Transform hourly activity array into expected format
    const hourlyActivity = (data.hourlyActivity || []).map((count: number, hour: number) => ({
      hour: `${hour.toString().padStart(2, '0')}:00`,
      count: count,
    }));

    // Transform daily trend data
    const dailyTrend = (data.trend7d || []).map((day: { date: string; sent?: number; incoming?: number }) => ({
      date: day.date,
      delivered: day.sent || 0,
      failed: (day.incoming || 0) - (day.sent || 0),
    }));

    return {
      total: stats['messages/total'] || 0,
      sent: stats['messages/SENT'] || 0,
      failed: stats['messages/DLQ'] || 0,
      dlq: stats['messages/DLQ'] || 0,
      created: stats['messages/CREATED'] || 0,
      queued: stats['messages/QUEUED'] || 0,
      delivered: stats['messages/DELIVER'] || stats['messages/SENT'] || 0,
      deliver: stats['messages/DELIVER'] || 0,
      retry: stats['messages/RETRY'] || 0,
      archived: stats['messages/ARCHIVED'] || 0,
      last24h: stats['messages/last24h'] || 0,
      last7d: stats['messages/last7d'] || 0,
      hourlyActivity,
      dailyTrend,
      trend7d: data.trend7d || [],
      storageType: 'TURSO', // You can get this from the environment or API
      hourlyStateChanges: data.hourlyStateChanges || [],
    };
  }

  /**
   * Get paginated list of messages
   */
  async getMessages(params: {
    limit?: number;
    offset?: number;
    status?: string;
  } = {}): Promise<{
    messages: Array<{
      id: string;
      url: string;
      status: string;
      retry_count: number;
      publish_at: string;
      created_at: string;
      updated_at: string;
      payload?: Record<string, unknown>;
      headers?: Record<string, string>;
      last_errors?: Array<{ message?: string; timestamp?: string }>;
    }>;
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = params.limit || 20;
    const offset = params.offset || 0;

    // Use admin/raw endpoint to get messages
    const response = await this.fetch('/admin/raw/messages');
    if (!response.ok) {
      throw new Error(`Failed to fetch messages: ${response.status}`);
    }

    const rawData = await response.json();

    // Transform the raw data into expected format
    const allMessages = rawData.map((item: { data: Record<string, unknown> }) => {
      const row = item.data;

      // Parse the payload to extract URL and headers
      let parsedPayload: Record<string, unknown> = {};
      let url = '';
      let headers: Record<string, string> = {};

      if (row.payload) {
        try {
          parsedPayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
          url = parsedPayload.url || '';
          headers = parsedPayload.headers || {};
          // Remove url and headers from payload data
          const { url: _, headers: __, ...payloadData } = parsedPayload;
          parsedPayload = payloadData;
        } catch (e) {
          console.error('Failed to parse payload:', e);
        }
      }

      return {
        id: row.id,
        url: url,
        status: row.status,
        retry_count: row.retried || 0,
        publish_at: row.publish_at,
        created_at: row.created_at,
        updated_at: row.updated_at || row.created_at,
        payload: parsedPayload.data || parsedPayload,
        headers: headers,
        last_errors: row.last_errors ? (typeof row.last_errors === 'string' ? JSON.parse(row.last_errors) : row.last_errors) : [],
      };
    });

    // Apply status filter if provided
    let filteredMessages = allMessages;
    if (params.status) {
      filteredMessages = allMessages.filter((msg: { status: string }) => msg.status === params.status.toUpperCase());
    }

    // Apply pagination
    const paginatedMessages = filteredMessages.slice(offset, offset + limit);

    return {
      messages: paginatedMessages,
      total: filteredMessages.length,
      limit: limit,
      offset: offset,
    };
  }

  /**
   * Get a single message by ID
   */
  async getMessage(messageId: string): Promise<{
    id: string;
    url: string;
    status: string;
    retry_count: number;
    publish_at: string;
    created_at: string;
    updated_at: string;
    payload?: Record<string, unknown>;
    headers?: Record<string, string>;
    last_errors?: Array<{ message?: string; timestamp?: string }>;
  }> {
    const response = await this.fetch(`/messages/${messageId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch message: ${response.status}`);
    }

    const data = await response.json();

    // Extract URL and headers from payload
    const url = data.payload?.url || '';
    const headers = data.payload?.headers || {};
    const payloadData = data.payload?.data || {};

    return {
      id: data.id,
      url: url,
      status: data.status,
      retry_count: data.retried || 0,
      publish_at: data.publish_at,
      created_at: data.created_at,
      updated_at: data.updated_at || data.created_at,
      payload: payloadData,
      headers: headers,
      last_errors: data.last_errors || [],
    };
  }

  /**
   * Get logs for a specific message
   */
  async getMessageLogs(messageId: string): Promise<
    Array<{
      id: string;
      type: string;
      message_id: string;
      before_data: Record<string, unknown> | null;
      after_data: Record<string, unknown> | null;
      created_at: string;
    }>
  > {
    const response = await this.fetch(`/admin/logs/message/${messageId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch message logs: ${response.status}`);
    }

    const data = await response.json();
    return data.logs || [];
  }

  /**
   * Recreate a message (create a new copy)
   */
  async recreateMessage(message: {
    url: string;
    payload?: Record<string, unknown>;
    headers?: Record<string, string>;
    publish_at?: string;
  }): Promise<{
    id: string;
    publish_at: string;
  }> {
    // Create new message with provided data
    const response = await this.fetch(`/messages/${encodeURIComponent(message.url)}`, {
      method: 'POST',
      body: JSON.stringify(message.payload || {}),
      headers: {
        'Content-Type': 'application/json',
        ...(message.headers || {}),
        // Add delay header if publish_at is in the future
        ...(message.publish_at && new Date(message.publish_at) > new Date() ? { 'X-Delay': `${Math.floor((new Date(message.publish_at).getTime() - Date.now()) / 1000)}s` } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to recreate message: ${response.status}`);
    }

    return await response.json();
  }
}
