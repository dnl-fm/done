import { err, ok } from 'result';
import { Dates } from '../utils/dates.ts';
import { Security } from '../utils/security.ts';
import { Secondary, SECONDARY_TYPE, Store } from '../utils/store.ts';
import { MESSAGE_STATUS, MessageData, MessageModel, MessageReceivedData } from './message-model.ts';

enum SECONDARIES {
  BY_STATUS = 'BY_STATUS',
  BY_PUBLISH_DATE = 'BY_PUBLISH_DATE',
}

export const MESSAGES_STORE_NAME = 'messages';
export const MESSAGES_MODEL_ID_PREFIX = 'msg';

export class MessagesStore extends Store {
  override getStoreName() {
    return MESSAGES_STORE_NAME;
  }

  override getModelIdPrefix(): string {
    return MESSAGES_MODEL_ID_PREFIX;
  }

  override buildModelId(): string {
    return Security.generateId();
  }

  override getSecondaries(model: MessageModel): Secondary[] {
    return [
      { type: SECONDARY_TYPE.MANY, key: [SECONDARIES.BY_STATUS, model.status] },
      { type: SECONDARY_TYPE.MANY, key: [SECONDARIES.BY_PUBLISH_DATE, Dates.getDateOnly(model.publishAt)] },
    ];
  }

  async fetch(id: string) {
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
    const response = await this.create({ payload: data.payload, publishAt: data.publishAt, status: MESSAGE_STATUS.CREATED }, { withId: data.id });

    return ok(response);
  }

  async create(data: MessageData, options?: { withId: string }) {
    const response = await this._create<MessageModel>({ ...data, retried: 0 }, options);

    return ok(response);
  }

  async update(id: string, data: Partial<MessageData>) {
    const response = await this._update<MessageModel>(id, data);

    return ok(response);
  }

  async delete(id: string) {
    ok(await this._delete(id));
  }
}
