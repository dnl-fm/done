import { Hono } from 'hono';

/**
 * Utility class for route initialization and management.
 */
export class Routes {
  /**
   * Initializes a new Hono router instance with optional base path.
   * @param {object} [options] - Router initialization options.
   * @param {string} [options.basePath] - Base path prefix for all routes.
   * @returns {Hono} A new Hono router instance.
   */
  static initHono(options?: { basePath?: string }) {
    if (!options) options = {};

    const routes = new Hono();

    if (options?.basePath) {
      routes.basePath(options.basePath);
    }

    return routes;
  }
}
