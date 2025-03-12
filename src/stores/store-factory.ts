import { Client } from 'libsql-core';
import { KvMessagesStore } from './kv-messages-store.ts';
import { MessagesStoreInterface } from './messages-store-interface.ts';
import { TursoMessagesStore } from './turso-messages-store.ts';

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
}
