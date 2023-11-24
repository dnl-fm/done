export enum MESSAGE_STATUS {
  CREATED = 'CREATED',
  QUEUED = 'QUEUED',
  DELIVER = 'DELIVER',
  SENT = 'SENT',
  RETRY = 'RETRY',
  DLQ = 'DLQ',
  ARCHIVED = 'ARCHIVED',
}

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
  publishAt: Date;
  payload: MessagePayload;
};

export type MessageLastError = {
  url: string;
  status?: number;
  message: string;
  createdAt: Date;
};

export type MessageData = {
  payload: MessagePayload;
  publishAt: Date;
  deliveredAt?: Date;
  retryAt?: Date;
  retried?: number;
  status: MESSAGE_STATUS;
  lastErrors?: MessageLastError[];
};

export type MessageModel = MessageData & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};
