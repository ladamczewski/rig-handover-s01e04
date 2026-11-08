import type { Hono } from 'hono';
import { readNight } from './reader.js';

export function registerDigestJsonRoutes(app: Hono, runsDir: string): void {
  app.get('/api/digest/:night', (c) => {
    let result;
    try {
      result = readNight(runsDir, c.req.param('night'));
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return c.json({ error: 'night not found' }, 404);
    }

    if (result === null) {
      return c.json({ error: 'night not found' }, 404);
    }

    return c.json(result);
  });
}
