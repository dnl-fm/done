import { MessagesStoreInterface } from '../interfaces/messages-store-interface.ts';
import { KvStore, SYSTEM_MESSAGE_TYPE, SystemMessage } from '../services/storage/kv-store.ts';
import { MessageModel, MessageReceivedData } from '../stores/kv/kv-message-model.ts';
import { Dates } from '../utils/dates.ts';
import { Http } from '../utils/http.ts';

const RETRY_DELAY_MINUTES = 1;

export class MessageStateManager {
  constructor(private kv: Deno.Kv, private messageStore: MessagesStoreInterface) {}

  async handleState(message: SystemMessage) {
    const model = this.getModelFromMessage<MessageModel>(message);
    console.log(`[${new Date().toISOString()}] MessageStateManager: handling ${message.type}, model status: ${model?.status}, model id: ${model?.id}`);

    // handle message type
    switch (message.type) {
      case SYSTEM_MESSAGE_TYPE.MESSAGE_RECEIVED:
        await this.messageStore.createFromReceivedData(message.data as MessageReceivedData);
        return;
      case SYSTEM_MESSAGE_TYPE.MESSAGE_QUEUED:
      case SYSTEM_MESSAGE_TYPE.MESSAGE_RETRY:
        await this.messageStore.update(model.id, { status: 'DELIVER' });
        return;
      default:
    }

    // handle model state
    console.log(`[${new Date().toISOString()}] MessageStateManager: processing model state: ${model?.status}`);
    switch (model.status) {
      case 'CREATED':
        console.log(`[${new Date().toISOString()}] MessageStateManager: calling stateCreated for ${model.id}`);
        await this.stateCreated(model);
        break;
      case 'QUEUED':
        await this.stateQueued(model);
        break;
      case 'DELIVER':
        await this.stateDeliver(model);
        break;
      case 'SENT':
        await this.stateSent(model);
        break;
      case 'RETRY':
        await this.stateRetry(model);
        break;
      case 'DLQ':
        await this.stateDLQ(model);
        break;
      default:
        console.warn(`[${new Date().toISOString()}] MessageStateManager: unknown status ${model?.status}`);
    }
  }

  private async stateCreated(model: MessageModel) {
    const today = new Date();
    console.log(`[${new Date().toISOString()}] stateCreated: checking if should deliver now. publish_at: ${model.publish_at.getTime()}, now: ${today.getTime()}`);

    // send now
    if (model.publish_at.getTime() < today.getTime()) {
      console.log(`[${new Date().toISOString()}] stateCreated: updating ${model.id} to DELIVER status`);
      await this.messageStore.update(model.id, { status: 'DELIVER' });
      return;
    }

    const todayDateOnly = Dates.getDateOnly(today);
    const publishAtDateOnly = Dates.getDateOnly(model.publish_at);

    // queue for later
    if (todayDateOnly === publishAtDateOnly) {
      await this.messageStore.update(model.id, { status: 'QUEUED' });
    }
  }

  private async stateQueued(model: MessageModel) {
    const today = new Date();
    const delay = model.publish_at.getTime() - today.getTime();

    const message: SystemMessage = {
      id: KvStore.buildLogId(),
      type: SYSTEM_MESSAGE_TYPE.MESSAGE_QUEUED,
      object: this.messageStore.getStoreName(),
      data: model,
      created_at: new Date(),
    };

    await this.kv.enqueue(message, { delay });
  }

  private async stateRetry(model: MessageModel) {
    console.debug(`[${new Date().toISOString()}] retry message ${model.id}`);

    const delay = model.retry_at ? model.retry_at.getTime() - new Date().getTime() : 0; // retryAt or immediately

    const message: SystemMessage = {
      id: KvStore.buildLogId(),
      type: SYSTEM_MESSAGE_TYPE.MESSAGE_RETRY,
      object: this.messageStore.getStoreName(),
      data: model,
      created_at: new Date(),
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
        await this.messageStore.update(model.id, { delivered_at: new Date(), status: 'SENT' });
        return;
      }

      responseStatus = response.status;
      lastDeliveryErrorMessage = 'invalid response status';
    } catch (error) {
      lastDeliveryErrorMessage = error instanceof Error ? error.message : 'unknown error';
    }

    if (!model.last_errors) {
      model.last_errors = [];
    }

    model.last_errors.push({
      url: model.payload.url,
      status: responseStatus,
      message: lastDeliveryErrorMessage,
      created_at: new Date(),
    });

    // retry
    if (model.retried !== undefined && model.retried < 3) {
      const delay = 1000 * 60 * RETRY_DELAY_MINUTES;

      await this.messageStore.update(model.id, {
        last_errors: model.last_errors,
        retried: model.retried + 1,
        retry_at: new Date(new Date().getTime() + delay),
        status: 'RETRY',
      });

      return;
    }

    // send to DLQ
    await this.messageStore.update(model.id, { last_errors: model.last_errors, status: 'DLQ' });
  }

  private stateSent(model: MessageModel) {
    console.debug(`[${new Date().toISOString()}] sent message ${model.id} to ${model.payload.url} at ${model.delivered_at?.toISOString()}`);
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
}
