export type DigestStatus = 'ok' | 'retry' | 'fail';

/** One job's valid run records, aggregated for a single night. */
export type DigestRow = {
  job: string;
  /** Owner on the last record, including null (display null as "—"). */
  owner: string | null;
  /** Number of valid records for this job, including retries and failures. */
  runs: number;
  /** Number of this job's records whose status is "retry". */
  retries: number;
  lastStatus: DigestStatus;
  /** Error on the last record; null if absent, not an earlier record's error. */
  lastError: string | null;
  /** Earliest record's original timestamp string, retaining its UTC offset. */
  firstAt: string;
  /** Latest record's original timestamp string, retaining its UTC offset. */
  lastAt: string;
};

/** An existing file's digest; an empty file yields { rows: [], badLines: 0 }. */
export type ReadNightResult = {
  /** One row per job, sorted ascending by job using string comparison. */
  rows: DigestRow[];
  /** Non-blank lines rejected as invalid JSON or invalid run records. */
  badLines: number;
};

/**
 * Contract for the synchronous readNight(runsDir, night) reader.
 *
 * This module exports types only, not a runtime reader. The implementation
 * belongs in src/digest/reader.ts and must expose:
 *   export const readNight: ReadNight = (runsDir, night) => ...
 *
 * Read <runsDir>/<night>.jsonl, with night in YYYY-MM-DD form. Reject a night
 * outside that form with RangeError before accessing the filesystem.
 * Return null only for ENOENT (including a missing runsDir); propagate other
 * filesystem errors. An existing file always returns ReadNightResult, even
 * when empty or when every non-blank line is invalid.
 *
 * Ignore blank/whitespace-only lines. Count each other invalid line once in
 * badLines without throwing or including it in rows. A valid record is a JSON
 * object with at (an ISO 8601 timestamp with explicit Z or numeric UTC offset),
 * job (a non-empty string), status (DigestStatus), owner (string or null), and
 * optional error (string). Unknown fields are ignored.
 *
 * Group records by the exact job string. Order each job's records by timestamp
 * instant, breaking ties by original line order (earlier lines first). firstAt
 * comes from the first record; lastAt, owner, lastStatus and lastError come
 * from the last record. Do not compare timestamps lexicographically.
 * Preserve original timestamp strings, including their offsets; never replace
 * them with UTC-normalized strings.
 *
 * Consumers render null owner/error as "—"; rows: [] means "nothing ran".
 * The HTML and JSON routes must use the same rows and ordering.
 */
export type ReadNight = (
  runsDir: string,
  night: string,
) => ReadNightResult | null;
