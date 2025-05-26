export class KvUtilStore {
  constructor(private kv: Deno.Kv) {}

  async reset() {
    console.log('resetting kv store');
    const entries = this.kv.list({ prefix: [] });
    for await (const entry of entries) {
      await this.kv.delete(entry.key);
    }
  }
}
