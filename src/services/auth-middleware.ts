import type { Context, Next } from 'hono';

export interface AuthConfig {
  token: string;
  skipPaths?: string[];
}

export class AuthMiddleware {
  static bearer(config: AuthConfig) {
    const skipPaths = config.skipPaths || [];

    return async (c: Context, next: Next) => {
      // Check if path should skip auth
      if (skipPaths.some((path) => c.req.path === path)) {
        await next();
        return;
      }

      const auth = c.req.header('Authorization');
      if (!auth || !auth.startsWith('Bearer ') || auth.split(' ')[1] !== config.token) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      await next();
    };
  }
}
