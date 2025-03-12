import type { Client } from 'libsql-core';

export type InMemory = ':memory:';

export type SqliteConfig = {
  url: URL | InMemory;
  authToken?: string;
};

export class SqliteStore {
  private client!: Client;

  static async create(urlString: string, authToken?: string) {
    let url: URL | InMemory;
    url = ':memory:';

    if (urlString !== ':memory:') {
      url = new URL(urlString);
    }

    const sqlite = new SqliteStore({ url, authToken });

    return await sqlite.getClient();
  }

  constructor(private readonly config: SqliteConfig) {
  }

  async getClient() {
    if (!this.client) {
      await this.createClient();
    }

    return this.client;
  }

  private async createClient() {
    // in memory
    if (this.config.url === ':memory:') {
      const libsqlNode = await import('libsql-node');
      this.client = libsqlNode.createClient({ url: ':memory:' });
      await this.setPragma();

      return this;
    }

    // local db file
    if (this.isFileUrl(this.config.url)) {
      const libsqlNode = await import('libsql-node');
      this.client = libsqlNode.createClient({ url: this.config.url.href });
      await this.setPragma();

      return this;
    }

    // remote db
    // due to deno limitations we need to use libsql-web
    const libsqlWeb = await import('libsql-web');

    this.client = libsqlWeb.createClient({
      url: this.config.url.href,
      authToken: this.config.authToken,
    });

    return this;
  }

  private isFileUrl(url: URL): boolean {
    return url.href.startsWith('file:');
  }

  private async setPragma() {
    await this.client.execute('PRAGMA journal_mode = WAL;');
    await this.client.execute('PRAGMA busy_timeout = 5000;');
    await this.client.execute('PRAGMA synchronous = NORMAL;');
    await this.client.execute('PRAGMA cache_size = 2000;');
    await this.client.execute('PRAGMA temp_store = MEMORY;');
    await this.client.execute('PRAGMA foreign_keys = true;');
  }
}
