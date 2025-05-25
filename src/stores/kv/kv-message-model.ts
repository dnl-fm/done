export type MESSAGE_STATUS = 'CREATED' | 'QUEUED' | 'DELIVER' | 'SENT' | 'RETRY' | 'DLQ' | 'ARCHIVED';

export type MessagePayload = {
  headers: {
    forward: Record<string, string>;
    command: Record<string, string>;
  };
  url: string;
  data?: unknown;
};

export type MessageReceivedData = {
  id: string;
  publish_at: Date;
  payload: MessagePayload;
};

export type MessageLastError = {
  url: string;
  status?: number;
  message: string;
  created_at: Date;
};

export type MessageData = {
  payload: MessagePayload;
  publish_at: Date;
  delivered_at?: Date;
  retry_at?: Date;
  retried?: number;
  status: MESSAGE_STATUS;
  last_errors?: MessageLastError[];
};

export type MessageModel = MessageData & {
  id: string;
  created_at: Date;
  updated_at: Date;
};
