import { MESSAGE_STATUS, MessageModel, MessageReceivedData } from '../stores/message-model.ts';
import { MessagesStore } from '../stores/messages-store.ts';
import { Dates } from '../utils/dates.ts';
import { Http } from '../utils/http.ts';
import { Store, SYSTEM_MESSAGE_TYPE, SystemMessage } from '../utils/store.ts';

const RETRY_DELAY_MINUTES = 1;

export class MessageStateManager {
  constructor(private kv: Deno.Kv) {}

  async handleState(message: SystemMessage) {
    const model = this.getModelFromMessage<MessageModel>(message);

    // handle message type
    switch (message.type) {
      case SYSTEM_MESSAGE_TYPE.MESSAGE_RECEIVED:
        await this.getStore().createFromReceivedData(message.data as MessageReceivedData);
        return;
      case SYSTEM_MESSAGE_TYPE.MESSAGE_QUEUED:
      case SYSTEM_MESSAGE_TYPE.MESSAGE_RETRY:
        await this.getStore().update(model.id, { status: MESSAGE_STATUS.DELIVER });
        return;
      default:
    }

    // handle model state
    switch (model.status) {
      case MESSAGE_STATUS.CREATED:
        await this.stateCreated(model);
        break;
      case MESSAGE_STATUS.QUEUED:
        await this.stateQueued(model);
        break;
      case MESSAGE_STATUS.DELIVER:
        await this.stateDeliver(model);
        break;
      case MESSAGE_STATUS.SENT:
        await this.stateSent(model);
        break;
      case MESSAGE_STATUS.RETRY:
        await this.stateRetry(model);
        break;
      case MESSAGE_STATUS.DLQ:
        await this.stateDLQ(model);
        break;
      default:
    }
  }

  private async stateCreated(model: MessageModel) {
    const today = new Date();

    // send now
    if (model.publishAt.getTime() < today.getTime()) {
      await this.getStore().update(model.id, { status: MESSAGE_STATUS.DELIVER });
      return;
    }

    const todayDateOnly = Dates.getDateOnly(today);
    const publishAtDateOnly = Dates.getDateOnly(model.publishAt);

    // queue for later
    if (todayDateOnly === publishAtDateOnly) {
      await this.getStore().update(model.id, { status: MESSAGE_STATUS.QUEUED });
    }
  }

  private async stateQueued(model: MessageModel) {
    const today = new Date();
    const delay = model.publishAt.getTime() - today.getTime();

    const message: SystemMessage = {
      id: Store.buildLogId(),
      type: SYSTEM_MESSAGE_TYPE.MESSAGE_QUEUED,
      object: this.getStore().getStoreName(),
      data: model,
      createdAt: new Date(),
    };

    await this.kv.enqueue(message, { delay });
  }

  private async stateRetry(model: MessageModel) {
    console.debug(`[${new Date().toISOString()}] retry message ${model.id}`);

    const delay = model.retryAt ? model.retryAt.getTime() - new Date().getTime() : 0; // retryAt or immediately

    const message: SystemMessage = {
      id: Store.buildLogId(),
      type: SYSTEM_MESSAGE_TYPE.MESSAGE_RETRY,
      object: this.getStore().getStoreName(),
      data: model,
      createdAt: new Date(),
    };

    await this.kv.enqueue(message, { delay });
  }

  private async stateDeliver(model: MessageModel) {
    console.debug(`[${new Date().toISOString()}] deliver message ${model.id} to ${model.payload.url}`);

    let lastDeliveryErrorMessage;
    let responseStatus: number | undefined;

    try {
      const options = {
        method: 'POST',
        headers: Http.buildDefaultCallbackHeaders(model.payload.headers.forward, { messageId: model.id, status: model.status, retried: model.retried || 0 }),
        body: model.payload.data ? JSON.stringify(model.payload.data) : undefined,
        signal: Http.getAbortSignal(),
      };

      const response = await fetch(model.payload.url, options);

      if (response.status === 200 || response.status === 201) {
        await this.getStore().update(model.id, { deliveredAt: new Date(), status: MESSAGE_STATUS.SENT });
        return;
      }

      responseStatus = response.status;
      lastDeliveryErrorMessage = 'invalid response status';
    } catch (error) {
      lastDeliveryErrorMessage = error.message;
    }

    if (!model.lastErrors) {
      model.lastErrors = [];
    }

    model.lastErrors.push({
      url: model.payload.url,
      status: responseStatus,
      message: lastDeliveryErrorMessage,
      createdAt: new Date(),
    });

    // retry
    if (model.retried !== undefined && model.retried < 3) {
      const delay = 1000 * 60 * RETRY_DELAY_MINUTES;

      await this.getStore().update(model.id, {
        lastErrors: model.lastErrors,
        retried: model.retried + 1,
        retryAt: new Date(new Date().getTime() + delay),
        status: MESSAGE_STATUS.RETRY,
      });

      return;
    }

    // send to DLQ
    await this.getStore().update(model.id, { lastErrors: model.lastErrors, status: MESSAGE_STATUS.DLQ });
  }

  private stateSent(model: MessageModel) {
    console.debug(`[${new Date().toISOString()}] sent message ${model.id} to ${model.payload.url} at ${model.deliveredAt?.toISOString()}`);
  }

  private async stateDLQ(model: MessageModel) {
    console.debug(`[${new Date().toISOString()}] failure-callback message ${model.id}`);

    const failureCallback = model.payload.headers.command['failure-callback'];

    if (!failureCallback) {
      return;
    }

    try {
      const headers: HeadersInit = Http.buildDefaultCallbackHeaders(model.payload.headers.forward, {
        messageId: model.id,
        status: model.status,
        retried: model.retried ? model.retried : 0,
      });

      const options = {
        headers,
        method: 'POST',
        body: JSON.stringify(model.payload.data),
        signal: Http.getAbortSignal(),
      };

      await fetch(failureCallback, options);
    } catch (error) {
      console.error(`failed to send message to failure callback: ${failureCallback}`, error);
    }
  }

  private getModelFromMessage<Model>(message: SystemMessage) {
    if (message.type === SYSTEM_MESSAGE_TYPE.STORE_DELETE_EVENT) {
      return (message.data as { before: Model }).before;
    }

    if ([SYSTEM_MESSAGE_TYPE.STORE_CREATE_EVENT, SYSTEM_MESSAGE_TYPE.STORE_UPDATE_EVENT].includes(message.type)) {
      return (message.data as { after: Model }).after;
    }

    return message.data as Model;
  }

  private getStore() {
    return new MessagesStore(this.kv);
  }
}
