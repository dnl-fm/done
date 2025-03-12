import { Client } from 'libsql-core';
import { SqliteStore } from '../services/storage/sqlite-store.ts';

const MIGRATIONS_DIR = new URL('../../migrations', import.meta.url);
// const MIGRATIONS_DIR = 'migrations';

export class Migrations {
  private client!: Client;

  constructor(private sqlite: SqliteStore) {}

  async migrate(options: { force: boolean } = { force: false }): Promise<void> {
    this.client = await this.sqlite.getClient();

    // Get list of migration files
    const migrationFiles = await this.getMigrationFiles();

    // Get applied migrations
    const appliedMigrations = await this.getAppliedMigrations();

    // Apply migrations in order
    for (const file of migrationFiles) {
      if (!appliedMigrations.includes(file) || options.force) {
        console.log(`Applying migration: ${file}`);
        await this.applyMigration(file);
      }
    }
  }

  private async getMigrationFiles(): Promise<string[]> {
    try {
      const files = [];
      for await (const entry of Deno.readDir(MIGRATIONS_DIR.pathname)) {
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
      const sql = await Deno.readTextFile(`${MIGRATIONS_DIR.pathname}/${filename}`);

      // Start transaction
      await this.client.execute('BEGIN TRANSACTION');

      try {
        // Split by semicolons to get individual SQL commands
        const commands = sql.split(';');

        for (const command of commands) {
          // Process the command to remove comments and empty lines
          const processedCommand = this.processCommand(command);

          // Only execute non-empty commands
          if (processedCommand) {
            await this.client.execute(`${processedCommand};`);
          }
        }

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

  private processCommand(command: string): string {
    // Split the command into lines
    const lines = command.split('\n');
    const processedLines: string[] = [];

    // Process each line
    for (const line of lines) {
      const trimmedLine = line.trim();

      // Skip empty lines and comment lines
      if (trimmedLine === '' || trimmedLine.startsWith('--')) {
        continue;
      }

      // For lines with inline comments, only keep the part before the comment
      const commentIndex = trimmedLine.indexOf('--');
      if (commentIndex >= 0) {
        const lineBeforeComment = trimmedLine.substring(0, commentIndex).trim();
        if (lineBeforeComment) {
          processedLines.push(lineBeforeComment);
        }
      } else {
        processedLines.push(trimmedLine);
      }
    }

    // Join the processed lines and return
    return processedLines.join(' ').trim();
  }
}
