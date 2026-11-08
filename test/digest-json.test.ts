import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readNight } from '../src/digest/reader.js';
import { registerDigestJsonRoutes } from '../src/digest/routes.js';
import type { ReadNight, ReadNightResult } from '../src/digest/types.js';

vi.mock('../src/digest/reader.js', () => ({
  readNight: vi.fn<ReadNight>(),
}));

const runsDir = '/tmp/digest-json-test-runs';
const night = '2026-10-28';
const result: ReadNightResult = {
  rows: [
    {
      job: 'alpha',
      owner: null,
      runs: 4,
      retries: 3,
      lastStatus: 'fail',
      lastError: 'job failed',
      firstAt: '2026-10-28T01:00:00+02:00',
      lastAt: '2026-10-28T02:00:00+02:00',
    },
    {
      job: 'beta',
      owner: 'rook',
      runs: 1,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-28T03:00:00+01:00',
      lastAt: '2026-10-28T03:00:00+01:00',
    },
  ],
  badLines: 1,
};

function createApp() {
  const app = new Hono();
  registerDigestJsonRoutes(app, runsDir);
  return app;
}

describe('digest JSON route', () => {
  beforeEach(() => {
    vi.mocked(readNight).mockReset();
  });

  it('returns the reader result unchanged, including job order and bad lines', async () => {
    vi.mocked(readNight).mockReturnValue(result);

    const res = await createApp().request(`/api/digest/${night}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(result);
    expect(readNight).toHaveBeenCalledExactlyOnceWith(runsDir, night);
  });

  it.each([0, 3])('returns 200 for no rows with %i bad lines', async (badLines) => {
    const emptyResult: ReadNightResult = { rows: [], badLines };
    vi.mocked(readNight).mockReturnValue(emptyResult);

    const res = await createApp().request(`/api/digest/${night}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(emptyResult);
  });

  it('returns 404 for a missing night', async () => {
    vi.mocked(readNight).mockReturnValue(null);

    const res = await createApp().request('/api/digest/2026-10-27');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'night not found' });
    expect(readNight).toHaveBeenCalledExactlyOnceWith(runsDir, '2026-10-27');
  });

  it('returns 404 when the reader rejects an invalid night with RangeError', async () => {
    vi.mocked(readNight).mockImplementation(() => {
      throw new RangeError('invalid night');
    });

    const res = await createApp().request('/api/digest/not-a-night');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'night not found' });
    expect(readNight).toHaveBeenCalledExactlyOnceWith(runsDir, 'not-a-night');
  });

  it.each([
    Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    new TypeError('unexpected reader failure'),
  ])('passes other reader errors to the application error handler: %s', async (error) => {
    vi.mocked(readNight).mockImplementation(() => {
      throw error;
    });
    const app = createApp();
    const onError = vi.fn((caught: Error) => new Response(caught.message, { status: 503 }));
    app.onError(onError);

    const res = await app.request(`/api/digest/${night}`);

    expect(res.status).toBe(503);
    expect(await res.text()).toBe(error.message);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe(error);
  });
});
