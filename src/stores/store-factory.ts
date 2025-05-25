import { Client } from 'libsql-core';
import { MessagesStoreInterface } from '../interfaces/messages-store-interface.ts';
import { LogsStoreInterface } from '../interfaces/logs-store-interface.ts';
import { KvMessagesStore } from './kv/kv-messages-store.ts';
import { KvLogsStore } from './kv/kv-logs-store.ts';
import { TursoMessagesStore } from './turso/turso-messages-store.ts';
import { TursoLogsStore } from './turso/turso-logs-store.ts';

export type StorageType = 'KV' | 'TURSO';

export class StoreFactory {
  static getStorageType(): StorageType {
    return (Deno.env.get('STORAGE_TYPE') || 'KV') as StorageType;
  }

  static getMessagesStore(instances: { kv: Deno.Kv; sqlite: Client }): MessagesStoreInterface {
    if (this.getStorageType() === 'KV') {
      return new KvMessagesStore(instances.kv);
    }

    return new TursoMessagesStore(instances.sqlite);
  }

  static getLogsStore(instances: { kv: Deno.Kv; sqlite: Client }): LogsStoreInterface {
    if (this.getStorageType() === 'KV') {
      return new KvLogsStore(instances.kv);
    }

    return new TursoLogsStore(instances.sqlite);
  }
}
