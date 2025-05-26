import { err, ok, Result } from 'result';
import { MessagesStoreInterface } from '../../interfaces/messages-store-interface.ts';
import { Secondary, SECONDARY_TYPE } from '../../services/storage/kv-store.ts';
import { StatsService } from '../../services/stats-service.ts';
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
  private statsService: StatsService;

  constructor(kv: Deno.Kv) {
    super(kv);
    this.statsService = new StatsService({ kv });
  }

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

    // Update stats when message is created
    await this.statsService.incrementStatus(data.status, data.publish_at);

    return ok(response);
  }

  async update(id: string, data: Partial<MessageData>) {
    // Get the current message to track status changes
    const currentMessage = await this._fetch<MessageModel>(id);
    if (!currentMessage) {
      return err('Message not found');
    }

    const response = await this._update<MessageModel>(id, data);

    // Update stats if status changed
    if (data.status && data.status !== currentMessage.status) {
      // When status changes to SENT, update the daily sent counter
      if (data.status === 'SENT') {
        const date = currentMessage.publish_at.toISOString().split('T')[0];
        await this.kv.atomic()
          .sum(['stats', 'messages', 'daily', date, 'sent'], 1n)
          .commit();
      }

      // Update status counters
      await this.statsService.decrementStatus(currentMessage.status, currentMessage.publish_at);
      await this.statsService.incrementStatus(data.status, currentMessage.publish_at);
    }

    return ok(response);
  }

  async delete(id: string): Promise<Result<boolean, string>> {
    // Get the message before deleting to update stats
    const message = await this._fetch<MessageModel>(id);
    if (message) {
      await this.statsService.decrementStatus(message.status, message.publish_at);
    }

    await this._delete(id);

    return ok(true);
  }
}
