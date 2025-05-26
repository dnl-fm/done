import type { Client, InArgs, InStatement as _InStatement, InValue, Transaction } from 'libsql-core';

type InMemory = ':memory:';

export type SqliteConfig = {
  url: URL | InMemory;
  authToken?: string;
};

export class SqliteStore {
  private client!: Client;

  static async create(url: string, authToken?: string) {
    const sqlite = new SqliteStore({ url: url as URL | InMemory, authToken });
    return await sqlite.getClient();
  }

  constructor(private readonly config: SqliteConfig) {}

  async getClient() {
    if (!this.client) {
      await this.createClient();
    }
    return this.client;
  }

  private async createClient() {
    const url = this.config.url instanceof URL ? this.config.url.toString() : this.config.url;

    // Handle different URL types
    if (url === ':memory:' || url.startsWith('file:')) {
      // Local SQLite - use libsql-node
      const libsqlNode = await import('libsql-node');
      console.log('Creating local SQLite client with URL:', url);

      this.client = libsqlNode.createClient({ url });
    } else {
      // Remote Turso DB - use libsql-web
      const libsqlWeb = await import('libsql-web');
      console.log('Creating remote Turso client with URL:', url);

      this.client = libsqlWeb.createClient({
        url: url,
        authToken: this.config.authToken,
      });
    }

    await this.setPragma();
  }

  private async setPragma() {
    // SQLite performance optimizations
    await this.client.execute('PRAGMA journal_mode = WAL');
    await this.client.execute('PRAGMA synchronous = NORMAL');
    await this.client.execute('PRAGMA cache_size = -64000'); // 64MB cache
    await this.client.execute('PRAGMA temp_store = MEMORY');
  }

  async runMigrations(migrations: { name: string; sql: string }[]) {
    // Create migrations table if it doesn't exist
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS migrations (
        name TEXT PRIMARY KEY,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Run each migration
    for (const migration of migrations) {
      const result = await this.client.execute({
        sql: 'SELECT 1 FROM migrations WHERE name = ?',
        args: [migration.name],
      });

      if (result.rows.length === 0) {
        console.log(`Running migration: ${migration.name}`);
        await this.client.execute(migration.sql);
        await this.client.execute({
          sql: 'INSERT INTO migrations (name) VALUES (?)',
          args: [migration.name],
        });
      }
    }
  }

  async execute(sql: string, args?: InValue[]) {
    return await this.client.execute({ sql, args: args as InArgs });
  }

  async batch(statements: { sql: string; args?: InValue[] }[]) {
    return await this.client.batch(statements.map((stmt) => ({
      sql: stmt.sql,
      args: stmt.args as InArgs,
    })));
  }

  async transaction(fn: (tx: Transaction) => Promise<void>) {
    const tx = await this.client.transaction();
    try {
      await fn(tx);
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }
}
