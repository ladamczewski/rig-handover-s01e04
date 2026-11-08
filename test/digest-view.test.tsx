import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { DigestRow, ReadNightResult } from '../src/digest/types.js';
import { DigestPage } from '../src/views/digest.js';

const row = (overrides: Partial<DigestRow> = {}): DigestRow => ({
  job: 'backup',
  owner: 'rook',
  runs: 4,
  retries: 2,
  lastStatus: 'ok',
  lastError: null,
  firstAt: '2026-10-28T22:00:00+02:00',
  lastAt: '2026-10-29T02:30:00-04:00',
  ...overrides,
});

async function render(digest: ReadNightResult, night = '2026-10-28') {
  const app = new Hono();
  app.get('/', (c) => c.html(<DigestPage night={night} digest={digest} />));
  const response = await app.request('/');
  expect(response.status).toBe(200);
  return response.text();
}

describe('digest view', () => {
  it('renders all columns, keeps timestamp offsets, and leaves the layout to its caller', async () => {
    const html = await render({ rows: [row()], badLines: 0 });

    expect(html).toContain('<h1>digest · 2026-10-28</h1>');
    for (const column of ['job', 'owner', 'runs', 'retries', 'last status', 'last error', 'first time', 'last time']) {
      expect(html).toContain(`<th scope="col">${column}</th>`);
    }
    for (const value of ['backup', 'rook', '4', '2', 'ok', '—', row().firstAt, row().lastAt]) {
      expect(html).toContain(`<td>${value}</td>`);
    }
    expect(html).not.toMatch(/<(?:html|head|body|style|script)\b/i);
    expect(html).not.toContain('Skipped invalid log lines');
  });

  it('sorts jobs by string comparison without mutating the supplied rows', async () => {
    const rows = ['zebra', 'alpha', 'Beta'].map((job) => row({ job }));
    const html = await render({ rows, badLines: 0 });

    expect(html.indexOf('<td>Beta</td>')).toBeLessThan(html.indexOf('<td>alpha</td>'));
    expect(html.indexOf('<td>alpha</td>')).toBeLessThan(html.indexOf('<td>zebra</td>'));
    expect(rows.map(({ job }) => job)).toEqual(['zebra', 'alpha', 'Beta']);
  });

  it('renders missing owner and error as dashes', async () => {
    const html = await render({ rows: [row({ owner: null, lastError: null })], badLines: 0 });

    expect(html.match(/<td>—<\/td>/g)).toHaveLength(2);
  });

  it('warns at three retries and above and for fail, not for two retries or retry status', async () => {
    const html = await render({
      rows: [
        row({ job: 'a', retries: 2, lastStatus: 'retry' }),
        row({ job: 'b', retries: 3, lastStatus: 'ok' }),
        row({ job: 'c', retries: 4, lastStatus: 'fail' }),
      ],
      badLines: 0,
    });

    expect(html).toContain('<td>2</td><td>retry</td>');
    expect(html).toContain('<td class="warn">3</td><td>ok</td>');
    expect(html).toContain('<td class="warn">4</td><td class="warn">fail</td>');
  });

  it('renders an empty night and reports bad lines even when there are no valid rows', async () => {
    const empty = await render({ rows: [], badLines: 0 });
    expect(empty).toContain('nothing ran');
    expect(empty).not.toContain('<table');
    expect(empty).not.toContain('Skipped invalid log lines');

    const invalid = await render({ rows: [], badLines: 2 });
    expect(invalid).toContain('nothing ran');
    expect(invalid).toContain('<p class="warn">Skipped invalid log lines: 2</p>');
  });

  it('reports skipped lines alongside valid rows', async () => {
    const html = await render({ rows: [row()], badLines: 1 });

    expect(html).toContain('<table>');
    expect(html).toContain('Skipped invalid log lines: 1');
    expect(html).not.toContain('nothing ran');
  });

  it('uses Hono escaping for the night, job, owner, and error, without client scripts', async () => {
    const unsafe = '<script>alert("x")</script>&';
    const html = await render({
      rows: [row({ job: unsafe, owner: unsafe, lastError: unsafe })],
      badLines: 0,
    }, unsafe);

    expect(html).not.toContain(unsafe);
    expect(html).not.toMatch(/<script\b/i);
    expect(html.match(/&lt;script&gt;/g)).toHaveLength(4);
    expect(html.match(/&amp;/g)).toHaveLength(4);
  });
});
