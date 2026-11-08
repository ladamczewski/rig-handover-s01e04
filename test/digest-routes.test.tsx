import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { DigestRow, DigestStatus, ReadNightResult } from '../src/digest/types.js';

const night = '2026-10-28';
const paths = [`/digest/${night}`, `/api/digest/${night}`];

type RunRecord = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    at: '2026-10-28T01:00:00+02:00',
    job: 'alpha',
    status: 'ok',
    owner: 'night-ops',
    ...overrides,
  };
}

function tableRows(html: string): string[] {
  return Array.from(html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi), ([row]) => row)
    .filter((row) => /<td\b/i.test(row));
}

function cells(row: string): string[] {
  return Array.from(row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), ([, cell]) =>
    cell.replace(/<[^>]*>/g, '').trim(),
  );
}

function jobRow(html: string, job: string): string {
  const matches = tableRows(html).filter((row) => cells(row).includes(job));
  expect(matches, `one table row for ${job}`).toHaveLength(1);
  return matches[0]!;
}

function hasWarning(row: string): boolean {
  return /\bclass\s*=\s*["'][^"']*\bwarn\b[^"']*["']/i.test(row);
}

describe('digest routes', () => {
  let runsDir: string | undefined;
  let config: RigConfig;

  beforeEach(() => {
    vi.stubEnv('LANE_ID', 'route-test-lane');
    vi.stubEnv('LANE_MARKER', 'DIGEST-ROUTE-TEST');
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    config = {
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    };
  });

  afterEach(() => {
    try {
      if (runsDir !== undefined) rmSync(runsDir, { recursive: true, force: true });
    } finally {
      runsDir = undefined;
      vi.unstubAllEnvs();
    }
  });

  function writeNight(records: RunRecord[], extraLines: string[] = []) {
    writeFileSync(
      join(config.runsDir, `${night}.jsonl`),
      [...records.map((entry) => JSON.stringify(entry)), ...extraLines].join('\n'),
      'utf8',
    );
  }

  it.each(paths)('returns 404 for a missing night: GET %s', async (path) => {
    const response = await createApp(config).request(path);
    expect(response.status).toBe(404);
  });

  it('returns the JSON envelope for an existing empty file', async () => {
    writeNight([]);
    const response = await createApp(config).request(`/api/digest/${night}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json\b/);
    expect(await response.json()).toEqual({ rows: [], badLines: 0 });
  });

  it('renders "nothing ran" for an existing empty file', async () => {
    writeNight([]);
    const response = await createApp(config).request(`/digest/${night}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html\b/);
    expect(html).toContain('nothing ran');
    expect(tableRows(html)).toEqual([]);
  });

  it('counts a malformed line without losing valid JSON rows or HTML rendering', async () => {
    writeNight([record()], ['{not valid JSON', '', '   ']);
    const app = createApp(config);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    const htmlResponse = await app.request(`/digest/${night}`);
    const html = await htmlResponse.text();

    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      rows: [{
        job: 'alpha',
        owner: 'night-ops',
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-28T01:00:00+02:00',
        lastAt: '2026-10-28T01:00:00+02:00',
      }],
      badLines: 1,
    });
    expect(htmlResponse.status).toBe(200);
    expect(cells(jobRow(html, 'alpha'))).toContain('night-ops');
    expect(html).not.toContain('nothing ran');
  });

  it('keeps a null-owner job in JSON and renders missing owner and error as em dashes', async () => {
    writeNight([record({ owner: null })]);
    const app = createApp(config);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    const htmlResponse = await app.request(`/digest/${night}`);

    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      rows: [{
        job: 'alpha',
        owner: null,
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-28T01:00:00+02:00',
        lastAt: '2026-10-28T01:00:00+02:00',
      }],
      badLines: 0,
    });
    expect(htmlResponse.status).toBe(200);
    const rowCells = cells(jobRow(await htmlResponse.text(), 'alpha'));
    expect(rowCells.filter((cell) => cell === '—')).toHaveLength(2);
    expect(rowCells).not.toContain('null');
    expect(rowCells).not.toContain('undefined');
  });

  it('marks three or more retries and failures, but not two retries or a healthy job', async () => {
    const retriedJob = (job: string, retries: number): RunRecord[] => [
      ...Array.from({ length: retries }, (_, index) => record({
        job,
        at: `2026-10-28T01:0${index}:00+02:00`,
        status: 'retry',
      })),
      record({ job, at: '2026-10-28T02:00:00+02:00' }),
    ];
    writeNight([
      record({ job: 'healthy' }),
      ...retriedJob('two-retries', 2),
      ...retriedJob('three-retries', 3),
      ...retriedJob('four-retries', 4),
      record({ job: 'failed', status: 'fail', error: 'upstream unavailable' }),
    ]);
    const response = await createApp(config).request(`/digest/${night}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(hasWarning(jobRow(html, 'healthy'))).toBe(false);
    expect(hasWarning(jobRow(html, 'two-retries'))).toBe(false);
    expect(hasWarning(jobRow(html, 'three-retries'))).toBe(true);
    expect(hasWarning(jobRow(html, 'four-retries'))).toBe(true);
    const failedRow = jobRow(html, 'failed');
    expect(hasWarning(failedRow)).toBe(true);
    expect(cells(failedRow)).toContain('fail');
    expect(cells(failedRow)).toContain('upstream unavailable');
  });

  it('serves the same sorted jobs and values in HTML and JSON, preserving timestamp offsets', async () => {
    writeNight([
      record({
        job: 'zulu',
        at: '2026-10-28T02:15:00+01:00',
        status: 'ok',
        owner: 'latest-owner',
      }),
      record({ job: 'middle', status: 'fail', error: 'disk full' }),
      record({
        job: 'zulu',
        at: '2026-10-28T03:00:00+03:00',
        status: 'retry',
        owner: 'earliest-owner',
        error: 'temporary failure',
      }),
      record({ job: 'alpha' }),
      record({
        job: 'zulu',
        at: '2026-10-28T02:30:00+02:00',
        status: 'retry',
        owner: 'middle-owner',
      }),
    ]);
    const expectedRows: DigestRow[] = [
      {
        job: 'alpha',
        owner: 'night-ops',
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-28T01:00:00+02:00',
        lastAt: '2026-10-28T01:00:00+02:00',
      },
      {
        job: 'middle',
        owner: 'night-ops',
        runs: 1,
        retries: 0,
        lastStatus: 'fail',
        lastError: 'disk full',
        firstAt: '2026-10-28T01:00:00+02:00',
        lastAt: '2026-10-28T01:00:00+02:00',
      },
      {
        job: 'zulu',
        owner: 'latest-owner',
        runs: 3,
        retries: 2,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-28T03:00:00+03:00',
        lastAt: '2026-10-28T02:15:00+01:00',
      },
    ];
    const expected: ReadNightResult = { rows: expectedRows, badLines: 0 };
    const app = createApp(config);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    const htmlResponse = await app.request(`/digest/${night}`);
    const html = await htmlResponse.text();

    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get('content-type')).toMatch(/^application\/json\b/);
    expect(await jsonResponse.json()).toEqual(expected);
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toMatch(/^text\/html\b/);
    expect(html.match(/<table\b/gi)).toHaveLength(1);
    const rows = tableRows(html);
    expect(rows).toHaveLength(expectedRows.length);
    expect(rows.map((row) => expectedRows.find((entry) => cells(row).includes(entry.job))?.job))
      .toEqual(expectedRows.map((row) => row.job));
    for (const expectedRow of expectedRows) {
      const rowCells = cells(jobRow(html, expectedRow.job));
      for (const value of Object.values(expectedRow)) {
        expect(rowCells).toContain(value === null ? '—' : String(value));
      }
    }
    expect(html).not.toContain('earliest-owner');
    expect(html).not.toContain('temporary failure');
    expect(html).not.toMatch(/<script\b/i);
  });

  it.each([
    ['DIGEST-ROUTE-TEST', 'DIGEST-ROUTE-TEST'],
    ['', 'no marker set'],
  ])('includes the lane banner with marker %j', async (marker, expectedMarker) => {
    vi.stubEnv('LANE_MARKER', marker);
    writeNight([record()]);
    const response = await createApp(config).request(`/digest/${night}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    const header = html.match(/<header\b[^>]*>[\s\S]*?<\/header>/i)?.[0];
    expect(header).toBeDefined();
    expect(header).toContain('route-test-lane');
    expect(header).toContain(expectedMarker);
  });
});
