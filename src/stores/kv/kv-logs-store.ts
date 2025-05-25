import { z } from 'zod';
import { LogsStoreInterface } from '../../interfaces/logs-store-interface.ts';
import { LogMessageDataSchema, LogMessageModelSchema } from '../../schemas/log-schema.ts';
import { Secondary, SECONDARY_TYPE } from '../../services/storage/kv-store.ts';
import { Security } from '../../utils/security.ts';
import { AbstractKvStore } from './abstract-kv-store.ts';

enum SECONDARIES {
  BY_MESSAGE_ID = 'BY_MESSAGE_ID',
}

export const LOGS_STORE_NAME = 'logs';
export const LOGS_MODEL_ID_PREFIX = 'log';

export class KvLogsStore extends AbstractKvStore implements LogsStoreInterface {
  getStoreName() {
    return LOGS_STORE_NAME;
  }

  getModelIdPrefix(): string {
    return LOGS_MODEL_ID_PREFIX;
  }

  override buildModelId(): string {
    return Security.generateId();
  }

  override getSecondaries(model: z.infer<typeof LogMessageModelSchema>): Secondary[] {
    return [
      { type: SECONDARY_TYPE.MANY, key: [SECONDARIES.BY_MESSAGE_ID, model.message_id] },
    ];
  }

  async create(data: z.infer<typeof LogMessageDataSchema>, options?: { withId: string }): Promise<z.infer<typeof LogMessageModelSchema>> {
    const response = await this._create<z.infer<typeof LogMessageModelSchema>>(data, options);
    return response;
  }
}
