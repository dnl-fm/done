import { Result } from 'result';
import { MESSAGE_STATUS, MessageModel } from './kv-message-model.ts';

export interface MessagesStoreInterface {
  getStoreName(): string;
  getModelIdPrefix(): string;
  buildModelId(): string;
  buildModelIdWithPrefix(): string;
  create(message: MessageModel): Promise<Result<MessageModel, string>>;
  fetch(id: string): Promise<Result<MessageModel, string>>;
  fetchByStatus(status: MESSAGE_STATUS): Promise<Result<MessageModel[], string>>;
  fetchByDate(date: Date): Promise<Result<MessageModel[], string>>;
  update(id: string, message: Partial<MessageModel>): Promise<Result<MessageModel, string>>;
  delete(id: string): Promise<Result<boolean, string>>;
}
