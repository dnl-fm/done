import { Context } from 'hono';
import { Routes } from '../utils/routes.ts';

/**
 * Handles routing for system-related endpoints.
 */
export class SystemRoutes {
  private basePath = `/system`;
  private routes = Routes.initHono({ basePath: this.basePath });

  /**
   * Gets the versioned base path for system routes.
   * @param {string} version - API version string.
   * @returns {string} The complete base path including version.
   */
  getBasePath(version: string) {
    return `/${version}/${this.basePath.replace('/', '')}`;
  }

  getRoutes() {
    this.routes.get('/ping', (c: Context) => {
      return c.text('pong');
    });

    this.routes.get('/health', (c: Context) => {
      return c.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
      });
    });

    return this.routes;
  }
}
