import { Hono } from 'hono';

export class Routes {
  static initHono(options?: { basePath?: string }) {
    if (!options) options = {};

    const routes = new Hono();

    if (options?.basePath) {
      routes.basePath(options.basePath);
    }

    return routes;
  }
}
