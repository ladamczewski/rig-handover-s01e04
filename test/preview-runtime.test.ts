import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../', import.meta.url));

describe('preview runtime outside the repository', () => {
  it('explicitly selects the source JSX configuration in the capture script', () => {
    const script = readFileSync(join(repo, 'scripts/save-preview.sh'), 'utf8');
    expect(script).toContain('export TSX_TSCONFIG_PATH="$repo/tsconfig.json"');
  });

  it('renders the board and digest from a temporary cwd without React or a server port', () => {
    const runtime = mkdtempSync(join(tmpdir(), 'rig-preview-runtime-'));
    try {
      for (const name of ['node_modules', 'rig.json', 'runs', 'tsconfig.json']) {
        symlinkSync(join(repo, name), join(runtime, name));
      }
      const child = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module'],
        {
          cwd: runtime,
          timeout: 15_000,
          encoding: 'utf8',
          env: {
            ...process.env,
            RIG_REPO: repo,
            TSX_TSCONFIG_PATH: join(repo, 'tsconfig.json'),
            LANE_MARKER: '',
          },
          input: `
            import assert from 'node:assert/strict';
            const { createApp } = await import(process.env.RIG_REPO + 'src/app.tsx');
            const app = createApp();
            for (const path of ['/', '/digest/2026-10-28']) {
              const response = await app.request(path);
              assert.equal(response.status, 200);
              const html = await response.text();
              assert(html.startsWith('<!doctype html>'));
              assert(html.includes('no marker set'));
              assert(!html.toLowerCase().includes('<script'));
            }
            console.log('preview runtime OK');
          `,
        },
      );
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout).toContain('preview runtime OK');
    } finally {
      rmSync(runtime, { recursive: true, force: true });
    }
  });
});
