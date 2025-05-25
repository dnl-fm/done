import { err, ok, Result } from 'result';
import { MessagesStoreInterface } from '../../interfaces/messages-store-interface.ts';
import { Secondary, SECONDARY_TYPE } from '../../services/storage/kv-store.ts';
import { Dates } from '../../utils/dates.ts';
import { Security } from '../../utils/security.ts';
import { AbstractKvStore } from './abstract-kv-store.ts';
import { MESSAGE_STATUS, MessageData, MessageModel, MessageReceivedData } from './kv-message-model.ts';

enum SECONDARIES {
  BY_STATUS = 'BY_STATUS',
  BY_PUBLISH_DATE = 'BY_PUBLISH_DATE',
}

export const MESSAGES_STORE_NAME = 'messages';
export const MESSAGES_MODEL_ID_PREFIX = 'msg';

export class KvMessagesStore extends AbstractKvStore implements MessagesStoreInterface {
  getStoreName() {
    return MESSAGES_STORE_NAME;
  }

  getModelIdPrefix(): string {
    return MESSAGES_MODEL_ID_PREFIX;
  }

  override buildModelId(): string {
    return Security.generateId();
  }

  override getSecondaries(model: MessageModel): Secondary[] {
    return [
      { type: SECONDARY_TYPE.MANY, key: [SECONDARIES.BY_STATUS, model.status] },
      { type: SECONDARY_TYPE.MANY, key: [SECONDARIES.BY_PUBLISH_DATE, Dates.getDateOnly(model.publish_at)] },
    ];
  }

  async fetchOne(id: string): Promise<Result<MessageModel, string>> {
    const model = await this._fetch<MessageModel>(id);

    if (model === null) {
      return err('Unknown message');
    }

    return ok(model);
  }

  async fetchByDate(date: Date) {
    const models = await this._fetchSecondary([SECONDARIES.BY_PUBLISH_DATE, Dates.getDateOnly(date)]);

    if (!models) {
      return ok([]);
    }

    return ok(await this.fetchMany<MessageModel>(models));
  }

  async fetchByStatus(status: MESSAGE_STATUS) {
    const models = await this._fetchSecondary([SECONDARIES.BY_STATUS, status]);

    if (!models) {
      return ok([]);
    }

    return ok(await this.fetchMany<MessageModel>(models));
  }

  async createFromReceivedData(data: MessageReceivedData) {
    return await this.create({ payload: data.payload, publish_at: data.publish_at, status: 'CREATED' }, { withId: data.id });
  }

  async create(data: MessageData, options?: { withId: string }) {
    const response = await this._create<MessageModel>({ ...data, retried: 0 }, options);

    return ok(response);
  }

  async update(id: string, data: Partial<MessageData>) {
    const response = await this._update<MessageModel>(id, data);

    return ok(response);
  }

  async delete(id: string): Promise<Result<boolean, string>> {
    await this._delete(id);

    return ok(true);
  }
}
