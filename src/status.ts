import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNightCounts } from './digest/reader.js';
import { lastBeat, type Beat } from './heartbeat.js';

export type NightCounts = NonNullable<ReturnType<typeof readNightCounts>>;

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: string[];
  nightCounts?: Partial<Record<string, NightCounts | null>>;
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function readStatus(config: RigConfig): Status {
  const nights = nightsOnDisk(config.runsDir);
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights,
    nightCounts: Object.fromEntries(
      nights.map((night) => [night, readNightCounts(config.runsDir, night)]),
    ),
  };
}
