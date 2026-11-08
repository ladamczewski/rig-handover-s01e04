import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, ReadNight } from './types.js';

type RunRecord = {
  at: string;
  instant: number;
  fraction: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error: string | null;
};

function validDate(date: string): boolean {
  if (date.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function timestampInstant(at: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):?(\d{2}))$/.exec(at);
  if (!match || match[0].length !== at.length || !validDate(match[1])) return null;
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return null;
  if (match[5] !== 'Z' && (Number(match[6]) > 23 || Number(match[7]) > 59)) return null;
  const instant = Date.parse(at);
  return Number.isFinite(instant) ? instant : null;
}

function parseRecord(value: unknown): RunRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.at !== 'string' || typeof record.job !== 'string' || record.job.length === 0) return null;
  if (record.status !== 'ok' && record.status !== 'retry' && record.status !== 'fail') return null;
  if (record.owner !== null && typeof record.owner !== 'string') return null;
  if ('error' in record && typeof record.error !== 'string') return null;
  const instant = timestampInstant(record.at);
  if (instant === null) return null;
  return {
    at: record.at,
    instant,
    fraction: (/\.(\d+)/.exec(record.at)?.[1] ?? '').replace(/0+$/, ''),
    job: record.job,
    status: record.status,
    owner: record.owner,
    error: typeof record.error === 'string' ? record.error : null,
  };
}

// Both public readers share the filesystem rules and unknown-input validation.
function readRecords(runsDir: string, night: string): { records: RunRecord[]; badLines: number } | null {
  if (!validDate(night)) throw new RangeError('night must be a valid YYYY-MM-DD date');
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  const records: RunRecord[] = [];
  let badLines = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    const record = parseRecord(value);
    if (record) records.push(record);
    else badLines++;
  }
  return { records, badLines };
}

export const readNight: ReadNight = (runsDir, night) => {
  const parsed = readRecords(runsDir, night);
  if (parsed === null) return null;
  const jobs = new Map<string, DigestRow>();
  // Keep sub-millisecond precision; Date.parse alone truncates fractional seconds.
  // ES2023's stable sort preserves original line order for equal instants.
  const ordered = parsed.records.sort((a, b) => a.instant - b.instant
    || (a.fraction < b.fraction ? -1 : a.fraction > b.fraction ? 1 : 0));
  for (const record of ordered) {
    const row = jobs.get(record.job);
    if (row) {
      row.runs++;
      if (record.status === 'retry') row.retries++;
      row.owner = record.owner;
      row.lastStatus = record.status;
      row.lastError = record.error;
      row.lastAt = record.at;
    } else {
      jobs.set(record.job, {
        job: record.job,
        owner: record.owner,
        runs: 1,
        retries: record.status === 'retry' ? 1 : 0,
        lastStatus: record.status,
        lastError: record.error,
        firstAt: record.at,
        lastAt: record.at,
      });
    }
  }
  const rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { rows, badLines: parsed.badLines };
};

/** Counts valid events, not jobs' final statuses; shares readNight's parser. */
export function readNightCounts(
  runsDir: string,
  night: string,
): { ok: number; retry: number; fail: number } | null {
  const parsed = readRecords(runsDir, night);
  if (parsed === null) return null;
  const counts = { ok: 0, retry: 0, fail: 0 };
  for (const record of parsed.records) counts[record.status]++;
  return counts;
}
