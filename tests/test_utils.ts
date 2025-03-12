import { SYSTEM_MESSAGE_TYPE, SystemMessage } from '../src/services/storage/kv-store.ts';

/**
 * Creates a test message for queue operations
 */
export function createTestMessage(): SystemMessage {
  return {
    id: `test_${crypto.randomUUID()}`,
    type: SYSTEM_MESSAGE_TYPE.MESSAGE_RECEIVED,
    data: { test: 'data' },
    object: 'test',
    createdAt: new Date(),
  };
}

/**
 * Waits for the specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a random key for testing
 */
export function randomKey(): string[] {
  return [`test_${crypto.randomUUID()}`];
}

/**
 * Generates a random value for testing
 */
export function randomValue(): { test: string } {
  return { test: crypto.randomUUID() };
}

/**
 * Remove test database file
 */
export function removeDbFile(path: string): void {
  try {
    Deno.removeSync(path);
  } catch (e) {
    // Ignore if file doesn't exist
    if (!(e instanceof Deno.errors.NotFound)) {
      console.error(`Failed to remove test database: ${e}`);
    }
  }
}
