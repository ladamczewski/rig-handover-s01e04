import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight, readNightCounts } from '../src/digest/reader.js';

const night = '2026-10-28';
const directories: string[] = [];
function tempRuns(lines: unknown[] = []): string {
  const directory = mkdtempSync(join(tmpdir(), 'rig-digest-reader-'));
  directories.push(directory);
  writeFileSync(join(directory, `${night}.jsonl`), lines.map(line => JSON.stringify(line)).join('\n'));
  return directory;
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook', ...overrides };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('readNight', () => {
  it('reads the real fixture without modifying it: five jobs and one bad line', () => {
    const runs = fileURLToPath(new URL('../runs/', import.meta.url));
    const result = readNight(runs, night);
    expect(result?.badLines).toBe(1);
    expect(result?.rows).toEqual([
      { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
      { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
      { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
      { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
        firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
      { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
    ]);
    expect(readNightCounts(runs, night)).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('sorts out-of-order records by instant, retaining offsets and line-order ties', () => {
    const runs = tempRuns([
      event({ at: '2026-10-29T01:00:00+02:00', status: 'fail', error: 'earlier tie' }),
      event({ at: '2026-10-29T00:30:00+02:00', status: 'retry', error: 'old error' }),
      event({ at: '2026-10-28T23:00:00Z', status: 'ok', owner: null }),
    ]);
    expect(readNight(runs, night)).toEqual({
      badLines: 0,
      rows: [{
        job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-29T00:30:00+02:00', lastAt: '2026-10-28T23:00:00Z',
      }],
    });
    expect(readNightCounts(runs, night)).toEqual({ ok: 1, retry: 1, fail: 1 });
  });

  it('takes owner, error and status from the latest instant, not the last line', () => {
    const runs = tempRuns([
      event({ at: '2026-10-29T00:00:00Z', owner: 'new owner', status: 'fail', error: 'latest' }),
      event({ at: '2026-10-28T23:00:00Z', owner: null }),
    ]);
    expect(readNight(runs, night)?.rows[0]).toMatchObject({
      owner: 'new owner', lastStatus: 'fail', lastError: 'latest',
      firstAt: '2026-10-28T23:00:00Z', lastAt: '2026-10-29T00:00:00Z',
    });
  });

  it('groups exact job strings and uses string comparison rather than locale sorting', () => {
    const jobs = ['a', 'Z', '__proto__', 'constructor', 'a ', 'a'];
    const runs = tempRuns(jobs.map(job => event({ job })));
    expect(readNight(runs, night)?.rows.map(row => [row.job, row.runs])).toEqual([
      ['Z', 1], ['__proto__', 1], ['a', 2], ['a ', 1], ['constructor', 1],
    ]);
  });

  it.each(['', ' \n\t\r\n\n'])('returns an existing empty digest for %j', text => {
    const runs = tempRuns();
    writeFileSync(join(runs, `${night}.jsonl`), text);
    expect(readNight(runs, night)).toEqual({ rows: [], badLines: 0 });
    expect(readNightCounts(runs, night)).toEqual({ ok: 0, retry: 0, fail: 0 });
  });

  it('returns null for a missing file or directory in both readers', () => {
    const runs = tempRuns();
    for (const reader of [readNight, readNightCounts]) {
      expect(reader(runs, '2026-10-27')).toBeNull();
      expect(reader(join(runs, 'missing'), night)).toBeNull();
    }
  });

  it.each(['', '../2026-10-28', '2026-10-28/../x', '2026-1-28', '2026-10-28\n',
    '2026-02-30', '2025-02-29', '2026-13-01', '2026-00-01', '2026-01-00'])(
    'rejects invalid night %j before accessing the filesystem', invalidNight => {
      const runs = tempRuns();
      const notDirectory = join(runs, `${night}.jsonl`);
      for (const reader of [readNight, readNightCounts]) {
        expect(() => reader(notDirectory, invalidNight)).toThrow(RangeError);
      }
    },
  );

  it('propagates filesystem failures other than ENOENT', () => {
    const runs = tempRuns();
    const notDirectory = join(runs, `${night}.jsonl`);
    mkdirSync(join(runs, '2026-10-27.jsonl'));
    for (const reader of [readNight, readNightCounts]) {
      expect(() => reader(notDirectory, night)).toThrow(expect.objectContaining({ code: 'ENOTDIR' }));
      expect(() => reader(runs, '2026-10-27')).toThrow(expect.objectContaining({ code: 'EISDIR' }));
    }
  });

  it('counts each invalid non-blank line once, ignoring unknown fields', () => {
    const invalid: unknown[] = [
      null, [], true, 42, 'text', {}, event({ job: '' }), event({ job: 5 }),
      event({ owner: undefined }), event({ owner: 1 }), event({ owner: false }),
      event({ status: 'unknown' }), event({ status: null }),
      event({ error: null }), event({ error: 5 }),
      event({ at: null }), event({ at: 'yesterday' }),
      event({ at: '2026-10-28' }), event({ at: '2026-10-28T23:00:00' }),
      event({ at: '2026-02-30T23:00:00Z' }), event({ at: '2025-02-29T23:00:00Z' }),
      event({ at: '2026-10-28T25:00:00Z' }), event({ at: '2026-10-28T23:60:00Z' }),
      event({ at: '2026-10-28T23:00:60Z' }), event({ at: '2026-10-28T23:00:00+25:00' }),
      event({ at: '2026-10-28T23:00:00+01:60' }),
    ];
    const runs = tempRuns(invalid);
    writeFileSync(join(runs, `${night}.jsonl`), [
      ...invalid.map(line => JSON.stringify(line)), '{broken', ' ', '',
      JSON.stringify(event({ extra: { ignored: true }, owner: null, error: '' })),
    ].join('\r\n'));
    expect(readNight(runs, night)).toMatchObject({
      badLines: invalid.length + 1,
      rows: [{ job: 'job', runs: 1, owner: null, lastError: '' }],
    });
    expect(readNightCounts(runs, night)).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('returns an empty digest, not null, when all records are invalid', () => {
    const runs = tempRuns([null, {}, []]);
    expect(readNight(runs, night)).toEqual({ rows: [], badLines: 3 });
    expect(readNightCounts(runs, night)).toEqual({ ok: 0, retry: 0, fail: 0 });
  });

  it('retains fractional seconds and compact numeric offsets on a leap date', () => {
    const at = '2024-02-29T23:00:00.123+0130';
    const runs = tempRuns([event({ at })]);
    expect(readNight(runs, night)?.rows[0]).toMatchObject({ firstAt: at, lastAt: at });
  });

  it('orders sub-millisecond instants and treats equivalent fractional forms as ties', () => {
    const runs = tempRuns([
      event({ at: '2026-10-28T23:00:00.0002Z', status: 'fail', error: 'latest' }),
      event({ at: '2026-10-28T23:00:00.0001Z', status: 'retry' }),
      event({ at: '2026-10-29T00:00:00.000200+01:00', owner: null }),
    ]);
    expect(readNight(runs, night)?.rows[0]).toMatchObject({
      firstAt: '2026-10-28T23:00:00.0001Z',
      lastAt: '2026-10-29T00:00:00.000200+01:00',
      lastStatus: 'ok', lastError: null, owner: null,
    });
  });

  it('counts every valid event rather than final job statuses', () => {
    const runs = tempRuns([
      event({ status: 'retry' }), event({ status: 'retry' }),
      event({ status: 'fail' }), event({ status: 'ok' }), event({ status: 'ok' }),
    ]);
    expect(readNight(runs, night)?.rows[0]).toMatchObject({ runs: 5, retries: 2, lastStatus: 'ok' });
    expect(readNightCounts(runs, night)).toEqual({ ok: 2, retry: 2, fail: 1 });
  });
});
