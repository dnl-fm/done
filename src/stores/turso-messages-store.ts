import { Client } from 'libsql-core';
import { ok, Result } from 'result';
import { Security } from '../utils/security.ts';
import { MESSAGE_STATUS, MessageModel } from './kv-message-model.ts';
import { MessagesStoreInterface } from './messages-store-interface.ts';

export class TursoMessagesStore implements MessagesStoreInterface {
  constructor(private sqlite: Client) {}

  getStoreName(): string {
    return 'messages';
  }

  getModelIdPrefix(): string {
    return 'msg';
  }

  buildModelId(): string {
    return Security.generateId();
  }

  buildModelIdWithPrefix(): string {
    return `${this.getModelIdPrefix().toLowerCase()}_${this.buildModelId()}`;
  }

  async create(message: MessageModel): Promise<Result<MessageModel, string>> {
    return ok(message);
  }

  async fetch(id: string): Promise<Result<MessageModel, string>> {
    return ok({ id } as MessageModel);
  }

  async fetchByStatus(status: MESSAGE_STATUS): Promise<Result<MessageModel[], string>> {
    return ok([]);
  }

  async fetchByDate(date: Date): Promise<Result<MessageModel[], string>> {
    return ok([]);
  }

  async update(id: string, message: MessageModel): Promise<Result<MessageModel, string>> {
    return ok(message);
  }

  async delete(id: string): Promise<Result<boolean, string>> {
    return ok(true);
  }
}
