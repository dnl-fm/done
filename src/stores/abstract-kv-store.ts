import { diff } from 'deep-object-diff';

import { Security } from '../utils/security.ts';

export type HasDates = {
  created_at: Date;
  updated_at: Date;
};

export type Model = HasDates & {
  id: string;
};

export type SYSTEM_MESSAGE_TYPE =
  | 'STORE_CREATE_EVENT'
  | 'STORE_UPDATE_EVENT'
  | 'STORE_DELETE_EVENT'
  | 'MESSAGE_RECEIVED'
  | 'MESSAGE_QUEUED'
  | 'MESSAGE_RETRY';

export type SYSTEM_MESSAGE_STATUS =
  | 'CREATED'
  | 'RECEIVED'
  | 'PROCESSED'
  | 'IGNORE';

export type SystemMessage = {
  id: string;
  type: SYSTEM_MESSAGE_TYPE;
  data: unknown;
  object: string;
  created_at: Date;
};

export type SECONDARY_TYPE = 'ONE' | 'MANY';

export type Secondary = {
  type: SECONDARY_TYPE;
  key: string[];
  value?: string[];
};

export abstract class AbstractKvStore {
  constructor(protected kv: Deno.Kv) {}

  abstract getStoreName(): string;
  abstract getModelIdPrefix(): string;

  static buildLogId() {
    return `log_${Security.generateSortableId()}`;
  }

  static buildLogKey(logId: string) {
    return [...AbstractKvStore.getStoresBaseKey(), 'logging', logId];
  }

  static buildLogSecondaryKey(messageId: string) {
    return [...AbstractKvStore.getStoresBaseKey(), 'logging', 'secondaries', 'BY_MESSAGE_ID', messageId];
  }

  static getStoresBaseKey() {
    return ['stores'];
  }

  static getCollectionBaseSecondaryKey() {
    return [...AbstractKvStore.getStoresBaseKey(), 'secondary'];
  }

  buildModelId() {
    return Security.generateId();
  }

  buildModelIdWithPrefix() {
    return `${this.getModelIdPrefix().toLowerCase()}_${this.buildModelId()}`;
  }

  // deno-lint-ignore no-unused-vars
  getSecondaries(model: unknown): Secondary[] {
    return [];
  }

  async fetchMany<Type>(ids: string[]) {
    const models: Type[] = [];

    for (const id of ids) {
      const episode = await this._fetch<Type>(id);

      if (episode) {
        models.push(episode);
      }
    }

    return this.sortByUpdatedAt(models as HasDates[]) as Type[];
  }

  sortByUpdatedAt<Type>(models: HasDates[], direction: 'asc' | 'desc' = 'desc') {
    models.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());

    if (direction === 'asc') {
      models.reverse();
    }

    return models as Type[];
  }

  protected async _reset(options?: { prop: string; value: string }) {
    const list = this._fetchAll<Record<string, unknown>>();

    for await (const entry of list) {
      let deleteEntry = true;

      if (options !== undefined) {
        deleteEntry = Object.prototype.hasOwnProperty.call(entry.value, options.prop) &&
          entry.value[options.prop] === options.value;
      }

      if (deleteEntry) {
        await this.kv.delete(entry.key);
      }
    }
  }

  protected async _fetch<Type>(id: string) {
    // console.log(`- fetch from ${this.getStoreName()}`, { id });
    const entry = await this.kv.get<Type>(this.buildPrimaryKey(id), { consistency: 'eventual' });

    return entry.value;
  }

  protected _fetchAll<Type>(options?: Deno.KvListOptions) {
    return this.kv.list<Type>({ prefix: this.buildPrimaryKey() }, options);
  }

  protected async _create<Type>(data: object, options?: { withId: string }) {
    const id = options?.withId || this.buildModelIdWithPrefix();
    const model = { id, ...data, created_at: new Date(), updated_at: new Date() };
    await this.kv.set(this.buildPrimaryKey(model.id), model);

    // HANDLE SECONDARIES

    for (const secondary of this.getSecondaries(model)) {
      secondary.value = secondary.value || [model.id];

      if (secondary.type === 'MANY') {
        const beforeRefs = await this._fetchSecondary(secondary.key);
        if (beforeRefs) secondary.value = [...beforeRefs, ...secondary.value];
      }

      await this._addSecondary(secondary);
    }

    await this.triggerWriteEvent('STORE_CREATE_EVENT', { after: model });

    return model as Type;
  }

  protected async _update<Type>(id: string, data: Partial<Type>) {
    const before = await this._fetch<Type>(id);

    if (!before) {
      throw new Error(`model not found ${id}`);
    }

    const after = { ...before, ...data, updatedAt: new Date() };
    await this.kv.set(this.buildPrimaryKey(id), after);

    // HANDLE SECONDARIES

    const secondariesWithOldData = this.getSecondaries(before);

    for (const [index, secondary] of Object.entries(this.getSecondaries(after))) {
      const oldKey = secondariesWithOldData[Number(index)].key;
      const newKey = secondary.key;

      await this._updateSecondary(secondary.type, oldKey, newKey, secondary.value || [id]);
    }

    await this.triggerWriteEvent('STORE_UPDATE_EVENT', { before, after });

    return after;
  }

  protected async _delete<Type>(id: string) {
    const before = await this._fetch<Type>(id);
    await this.kv.delete(this.buildPrimaryKey(id));

    // HANDLE SECONDARIES

    for (const secondary of this.getSecondaries(before)) {
      await this._deleteSecondary(secondary.key);
    }

    await this.triggerWriteEvent('STORE_DELETE_EVENT', { before });
  }

  protected async _fetchSecondary(key: string[]) {
    const secondaryKey = this.buildSecondaryKey(key);
    const entry = await this.kv.get<string[]>(secondaryKey);

    return entry.value;
  }

  protected cast<Type>(data: Omit<Type, 'id' | 'created_at' | 'updated_at'>): Omit<Type, 'id' | 'created_at' | 'updated_at'> {
    return data;
  }

  protected buildPrimaryKey(id?: string) {
    const keys = [...AbstractKvStore.getStoresBaseKey(), this.getStoreName()];

    if (id) {
      keys.push(id);
    }

    return keys;
  }

  private async _addSecondary(secondary: Secondary) {
    // console.log('- adding secondary', { key: secondary.key, values: secondary.value });
    await this.kv.set(this.buildSecondaryKey(secondary.key), secondary.value);
  }

  private async _updateSecondary(type: SECONDARY_TYPE, oldKey: string[], newKey: string[], value: string[]) {
    const beforeValues = await this._fetchSecondary(oldKey);

    // // console.log('- evaluating secondary update', { oldKey, newKey, value, beforeValues });

    const keyDidNotChange = oldKey.join('/') === newKey.join('/');

    if (type === 'ONE') {
      if (!keyDidNotChange) await this._deleteSecondary(oldKey);
      await this._updatingSecondary(newKey, value);
      return;
    }

    // key did not change so we simply add the new value
    if (keyDidNotChange) {
      const newValues = beforeValues ? [...new Set([...beforeValues, ...value])] : value;
      await this._updatingSecondary(oldKey, newValues);
      return;
    }

    // keys are different so we need to ...

    // 1. remove the value from old secondary
    if (beforeValues) {
      const newValue = value[0];
      const newBeforeValues = beforeValues.filter((before: string) => before !== newValue);

      switch (newBeforeValues.length) {
        case 0: // remove complete secondary index since we dont have any refs
          await this._deleteSecondary(oldKey);
          break;
        default: // update the secondary with the updated refs
          await this._updatingSecondary(oldKey, newBeforeValues);
      }
    }

    // 2. add the value to the new secondary
    const afterValues = await this._fetchSecondary(newKey);
    const newAfterValues = afterValues ? [...new Set([...afterValues, ...value])] : value;
    await this._updatingSecondary(newKey, newAfterValues);
  }

  private async _updatingSecondary(key: string[], value: string[]) {
    const unqiueValue = [...new Set(value)]; // remove duplicates
    // console.log('- updating secondary', { key, value: unqiueValue });
    await this.kv.set(this.buildSecondaryKey(key), unqiueValue);
  }

  private async _deleteSecondary(key: string[]) {
    // console.log('- delete secondary', { key });
    await this.kv.delete(this.buildSecondaryKey(key));
  }

  private buildSecondaryKey(key: string[]) {
    return [...this.buildPrimaryKey(), 'secondaries', ...key];
  }

  private async triggerWriteEvent(type: SYSTEM_MESSAGE_TYPE, data: { before?: unknown; after?: unknown }) {
    const log: SystemMessage = { type, data, id: AbstractKvStore.buildLogId(), object: this.getStoreName(), created_at: new Date() };

    // ##############################################
    // enqueue message
    await this.kv.enqueue(log);

    if (Deno.env.get('ENABLE_LOGS') !== 'true') {
      return;
    }

    // ##############################################
    // handle logging if enabled
    let messageId: string | undefined;

    switch (type) {
      case 'STORE_DELETE_EVENT':
        messageId = (data as { before: { id: string } }).before.id;
        break;
      default:
        messageId = (data as { after: { id: string } }).after.id;
    }

    if (data.before && data.after) {
      log.data = { id: messageId, diff: diff(data.before, data.after) };
    }

    // save log
    await this.kv.set(AbstractKvStore.buildLogKey(log.id), log);

    // add secondary to lookup logs by message id
    const secondaryKey = AbstractKvStore.buildLogSecondaryKey(messageId);
    const values = await this.kv.get<string[]>(secondaryKey);
    await this.kv.set(secondaryKey, Array.isArray(values.value) ? [...values.value, log.id] : [log.id]);
  }
}
