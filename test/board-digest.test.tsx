import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import * as reader from '../src/digest/reader.js';
import { readStatus, type Status } from '../src/status.js';
import { StatusBoard } from '../src/views/status.js';

describe('board digest links and event counts', () => {
  let runsDir: string;
  let config: RigConfig;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-board-digest-'));
    config = {
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('links every night newest first and counts events, not jobs or final statuses', async () => {
    const record = (status: 'ok' | 'retry' | 'fail') => JSON.stringify({
      at: '2026-10-28T02:00:00+01:00',
      job: 'same-job',
      owner: null,
      status,
    });
    writeFileSync(join(runsDir, '2026-10-27.jsonl'), record('ok'));
    writeFileSync(
      join(runsDir, '2026-10-28.jsonl'),
      [
        record('retry'), record('retry'), record('fail'),
        record('ok'), record('ok'), record('ok'),
        'broken JSON', '{"status":"ok"}', '',
      ].join('\n'),
    );
    writeFileSync(join(runsDir, 'notes.txt'), 'not a night');

    const status = readStatus(config);
    expect(status.nights).toEqual(['2026-10-28', '2026-10-27']);
    expect(status.nightCounts).toEqual({
      '2026-10-28': { ok: 3, retry: 2, fail: 1 },
      '2026-10-27': { ok: 1, retry: 0, fail: 0 },
    });

    const response = await createApp(config).request('/');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(
      '<li><a href="/digest/2026-10-28">2026-10-28</a> · ok 3 / retry 2 / fail 1</li>',
    );
    expect(html).toContain(
      '<li><a href="/digest/2026-10-27">2026-10-27</a> · ok 1 / retry 0 / fail 0</li>',
    );
    expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
    expect(html).not.toContain('notes.txt');
  });

  it('shows zero counts for an empty night', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), '');
    const response = await createApp(config).request('/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      '<a href="/digest/2026-10-28">2026-10-28</a> · ok 0 / retry 0 / fail 0',
    );
  });

  it('keeps the link and shows missing counts when the reader returns null', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), '');
    const counts = vi.spyOn(reader, 'readNightCounts').mockReturnValue(null);
    const response = await createApp(config).request('/');
    expect(counts).toHaveBeenCalledWith(runsDir, '2026-10-28');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      '<a href="/digest/2026-10-28">2026-10-28</a> · ok — / retry — / fail —',
    );
  });

  it('supports status values without a counts map or without an entry for a night', () => {
    const status: Status = {
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      lastBeat: null,
      nights: ['2026-10-28'],
    };
    for (const value of [status, { ...status, nightCounts: {} }]) {
      expect(StatusBoard({ status: value }).toString()).toContain(
        '<a href="/digest/2026-10-28">2026-10-28</a> · ok — / retry — / fail —',
      );
    }
  });

  it.each(['empty', 'missing'])('renders the empty board for a %s runs directory', async (kind) => {
    if (kind === 'missing') config.runsDir = join(runsDir, 'missing');
    expect(readStatus(config).nights).toEqual([]);
    expect(readStatus(config).nightCounts).toEqual({});
    const response = await createApp(config).request('/');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('nothing in runs/');
    expect(html).not.toContain('href="/digest/');
  });
});
