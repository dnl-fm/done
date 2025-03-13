import { assertEquals } from 'jsr:@std/assert';
import { beforeEach, describe, it } from 'jsr:@std/testing/bdd';
import { SystemRoutes } from '../../../src/routes/system-routes.ts';
import { AuthMiddleware } from '../../../src/services/auth-middleware.ts';
import { Routes } from '../../../src/utils/routes.ts';
import { VERSION_STRING } from '../../../src/version.ts';

describe('SystemRoutes integration tests', () => {
  let routes: SystemRoutes;
  let app: ReturnType<typeof Routes.initHono>;
  const AUTH_TOKEN = 'test_token';

  beforeEach(() => {
    // Setup routes
    routes = new SystemRoutes();
    app = Routes.initHono();

    // Add auth middleware
    app.use(
      `/${VERSION_STRING}/*`,
      AuthMiddleware.bearer({
        token: AUTH_TOKEN,
        skipPaths: [`/${VERSION_STRING}/system/ping`],
      }),
    );

    app.route(`/${VERSION_STRING}/system`, routes.getRoutes());
  });

  describe('GET /ping', () => {
    it('should return pong without authentication', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/system/ping`);
      const res = await app.fetch(req);

      assertEquals(res.status, 200);
      assertEquals(await res.text(), 'pong');
    });

    it('should return pong even with invalid authentication', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/system/ping`, {
        headers: {
          'Authorization': 'Bearer invalid_token',
        },
      });
      const res = await app.fetch(req);

      assertEquals(res.status, 200);
      assertEquals(await res.text(), 'pong');
    });
  });

  describe('GET /health', () => {
    it('should return 401 without authentication', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/system/health`);
      const res = await app.fetch(req);

      assertEquals(res.status, 401);
    });

    it('should return 401 with invalid authentication', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/system/health`, {
        headers: {
          'Authorization': 'Bearer invalid_token',
        },
      });
      const res = await app.fetch(req);

      assertEquals(res.status, 401);
    });

    it('should return health status with valid authentication', async () => {
      const req = new Request(`http://localhost/${VERSION_STRING}/system/health`, {
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`,
        },
      });
      const res = await app.fetch(req);

      assertEquals(res.status, 200);

      const body = await res.json();
      assertEquals(typeof body.status, 'string');
      assertEquals(body.status, 'healthy');
      assertEquals(typeof body.timestamp, 'string');

      // Verify timestamp is a valid ISO string
      const timestamp = new Date(body.timestamp);
      assertEquals(isNaN(timestamp.getTime()), false, 'Timestamp should be a valid date');
    });
  });
});
