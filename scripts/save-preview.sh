#!/usr/bin/env bash
# stdout is only the upload directory, never the marker or the response body.
set +x
set -euo pipefail
umask 077

if (( $# != 0 )); then
  echo "Usage: bash scripts/save-preview.sh (no arguments)" >&2
  exit 1
fi

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
temp_root=/private/tmp
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
  temp_root="${RUNNER_TEMP:?RUNNER_TEMP is required on the runner}"
fi
work="$(mktemp -d "$temp_root/rig-preview.XXXXXX")"
runtime="$work/runtime"
site="$work/site"
pid=
keep_site=false

cleanup() {
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf -- "$runtime"
  if [[ "$keep_site" != true ]]; then
    rm -rf -- "$work"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -- "$runtime" "$site"
# Keep the existing service and configuration; only its working directory changes.
# In particular, heartbeat writes go to temp, and no .env is copied or loaded.
ln -s "$repo/node_modules" "$runtime/node_modules"
ln -s "$repo/rig.json" "$runtime/rig.json"
ln -s "$repo/runs" "$runtime/runs"
ln -s "$repo/tsconfig.json" "$runtime/tsconfig.json"

export PORT=8787
# tsx must use the source project's JSX settings even from the temporary cwd.
# A symlinked tsconfig alone does not make tsx discover the Hono JSX runtime.
export TSX_TSCONFIG_PATH="$repo/tsconfig.json"
if [[ -z "${LANE_MARKER:-}" ]]; then
  unset LANE_MARKER
fi
cd -- "$runtime"
node --import tsx "$repo/src/server.ts" > "$runtime/server.log" 2>&1 &
pid=$!
base="http://127.0.0.1:$PORT"
ready=false
for (( attempt = 0; attempt < 60; attempt++ )); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Preview service exited; its private log will be removed." >&2
    exit 1
  fi
  # The existing server logs this only after listen succeeds. Do not accidentally
  # capture another service already occupying the fixed port.
  if grep --quiet --fixed-strings "http://localhost:$PORT" "$runtime/server.log" \
    && curl --noproxy '*' --fail --silent --connect-timeout 1 --max-time 1 \
    --output /dev/null "$base/health"; then
    ready=true
    break
  fi
  sleep 0.5
done
if [[ "$ready" != true ]] || ! kill -0 "$pid" 2>/dev/null; then
  echo "Preview service did not become ready on localhost." >&2
  exit 1
fi

# No redirects, browser save, rewriting, or body/marker output to the terminal.
response="$(curl --noproxy '*' --fail --silent --show-error \
  --connect-timeout 2 --max-time 15 \
  --output "$site/index.html" --write-out '%{http_code} %{content_type}' \
  "$base/digest/2026-10-28")"
if [[ "$response" != "200 text/html"* ]]; then
  echo "Digest did not return HTTP 200 HTML." >&2
  exit 1
fi
node --input-type=module - "$site/index.html" <<'NODE'
import { readFileSync } from 'node:fs';
const html = readFileSync(process.argv[2], 'utf8');
if (!/^<!doctype html>/i.test(html) || !/<\/html>\s*$/i.test(html)
    || !html.includes('<style>') || !html.includes('digest · 2026-10-28')
    || /<(?:script|link|img|iframe|object|embed|audio|video|source)\b/i.test(html)
    || (!(process.env.LANE_MARKER?.trim())
      && !html.includes('<span class="marker">no marker set</span>'))) {
  console.error('Digest is not the expected standalone static preview.');
  process.exit(1);
}
NODE

keep_site=true
printf '%s\n' "$site"
