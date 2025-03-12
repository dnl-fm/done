import { Client } from 'libsql-core';
import { SqliteStore } from '../services/storage/sqlite-store.ts';

export class MigrationManager {
  private client!: Client;

  constructor(private sqlite: SqliteStore) {}

  async migrate(): Promise<void> {
    this.client = await this.sqlite.getClient();

    // Get list of migration files
    const migrationFiles = await this.getMigrationFiles();

    // Get applied migrations
    const appliedMigrations = await this.getAppliedMigrations();

    // Apply migrations in order
    for (const file of migrationFiles) {
      if (!appliedMigrations.includes(file)) {
        console.log(`Applying migration: ${file}`);
        await this.applyMigration(file);
      }
    }
  }

  private async getMigrationFiles(): Promise<string[]> {
    try {
      const files = [];
      for await (const entry of Deno.readDir('src/migrations')) {
        if (entry.isFile && entry.name.endsWith('.sql')) {
          files.push(entry.name);
        }
      }
      return files.sort(); // Sort to ensure order
    } catch (error) {
      console.error('Failed to read migration files:', error);
      throw error;
    }
  }

  private async getAppliedMigrations(): Promise<string[]> {
    try {
      const result = await this.client.execute('SELECT name FROM migrations ORDER BY id');
      return result.rows.map((row) => row[0] as string);
    } catch (_error) {
      // If table doesn't exist yet, return empty array
      return [];
    }
  }

  private async applyMigration(filename: string): Promise<void> {
    try {
      const sql = await Deno.readTextFile(`src/migrations/${filename}`);

      // Start transaction
      await this.client.execute('BEGIN TRANSACTION');

      try {
        // Apply migration
        await this.client.execute(sql);

        // Record migration
        await this.client.execute({
          sql: 'INSERT INTO migrations (id, name) VALUES (?, ?)',
          args: [crypto.randomUUID(), filename],
        });

        // Commit transaction
        await this.client.execute('COMMIT');
      } catch (error) {
        // Rollback on error
        await this.client.execute('ROLLBACK');
        throw error;
      }
    } catch (error) {
      console.error(`Failed to apply migration ${filename}:`, error);
      throw error;
    }
  }
}
