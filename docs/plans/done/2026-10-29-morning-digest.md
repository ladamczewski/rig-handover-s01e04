---
plan: morning-digest
status: completed
owner: rook
opened: 2026-10-29
closed: 2026-11-08
---

# Morning digest

The night's run log is a JSONL file nobody reads. By breakfast someone has to know what ran,
what retried, what failed, and whose it was, without opening `runs/`. rig already serves the
status board; the digest is one more page on it.

Out of scope: notifications, history across nights, auth (rig only listens on localhost).

## 1. Run log reader

Read `runs/<night>.jsonl` into one row per job: job, owner, runs, retries, last status, last
error, first and last time. One JSON object per line (`at`, `job`, `status`: `ok | retry | fail`,
`owner`, optional `error`).

- A line that doesn't parse is counted, never thrown. The night still renders.
- `owner` can be `null`. Keep the row; show the owner as `—`.
- Lives in `src/digest/`. Commit `src/digest/types.ts` first (the `DigestRow` type and the
  `readNight(runsDir, night)` signature), so every part of section 2 can start against it.

Done when: reader tests pass on `runs/2026-10-28.jsonl` (5 jobs, 1 bad line).

## 2. Digest page

Four small parts. Each needs only `src/digest/types.ts` from section 1, so once that is in they
can go to four workers at once. Small, well-specified work: a cheaper model is fine here.

### 2a. Page

`GET /digest/:night` renders the rows with the usual layout: one table, sorted by job, retries of
3 or more and any `fail` marked. A night with no file returns 404; an empty file renders
"nothing ran".

Done when: `/digest/2026-10-28` renders locally.

### 2b. JSON

`GET /api/digest/:night` returns the same rows as JSON. Agents read this one; the page and the
JSON must never disagree (ADR 0001).

Done when: the JSON for 2026-10-28 has the same jobs, in the same order, as the page.

### 2c. Board link

The status board links each night on disk to its digest, with its ok / retry / fail counts beside
it.

Done when: both nights on disk link to a digest that renders.

### 2d. Route tests

Route tests for 2a and 2b: 200, 404 for a night with no file, the empty night, a night with a bad
line. Use a temp runs dir; `runs/` is read-only.

Done when: `pnpm test` is green with the new tests.

## 3. Preview for review

The reviewer reads the page from a copy, not from the lane. Run rig and save `/digest/2026-10-28` as
one HTML file, lane banner included (a command, not a browser's "save as"; the page is
self-contained, ADR 0001). Put it on your own public host, one where you can upload over it later (any bucket
or static host, ADR 0003), so it opens from a public HTTPS link. Send the reviewer the link and the
issues for this plan.

Done when: the preview link is sent to the reviewer.

## 4. Clean up

The preview carries this lane's marker on a public link (ADR 0003). Take the marker off: save the
page again with `LANE_MARKER` unset (the banner reads "no marker set") and upload it over the same
link. Move this plan to `docs/plans/done/` with its issue list.

Done when: the preview link no longer shows the lane marker.

## Issues

All issue numbers below refer to `ladamczewski/rig-handover-s01e04`.
Descriptions follow the source sections of this plan.

| # | Source section | Description |
|---|----------------|-------------|
| #1 | 1. Run log reader — contract | Define `DigestRow` and the `readNight(runsDir, night)` signature in `src/digest/types.ts` first, so the reader, views, JSON route and tests share one contract. |
| #2 | 1. Run log reader — implementation | Read JSONL into one row per job with owner, runs, retries, last status/error and first/last times; count malformed lines, preserve null owners and test the five-job, one-bad-line fixture. |
| #3 | 2a. Page | Render `GET /digest/:night` in the usual layout, sorted by job, highlighting retries of at least three and failures; handle missing and empty nights. |
| #4 | 2b. JSON | Serve the same rows in the same order at `GET /api/digest/:night`, keeping the API consistent with the HTML page. |
| #5 | 2c. Board link | Link each night on disk from the status board to its digest and show its ok / retry / fail counts. |
| #6 | 2d. Route tests | Test the HTML and JSON routes through `app.request()` for successful, missing, empty and malformed-line nights, using temporary directories without changing `runs/`. |
| #7 | 3. Preview for review | Export the self-contained digest HTML with the lane banner, publish it at a replaceable public HTTPS URL and send the reviewer that URL with this plan's issue list. |
| #8 | 4. Clean up | Replace the reviewed page at the same URL with an export made with `LANE_MARKER` unset, then archive this plan with its complete issue list and review/cleanup record. |

## Review and cleanup record

Actual completion date: **2026-11-08** (not the plan's opening date, 2026-10-29).
The evidence below was supplied by the coordinating worker; this documentation-only
worker did not publish or modify any preview.

- The course confirmed that the review had been viewed. This records review confirmation,
  not a claim that the course challenge is solved.
- Review run: `42517810505`.
- Clean run: `42519363894`, result: **success**.
- The same public URL was retained for review and cleanup:
  `https://ladamczewski.github.io/rig-handover-s01e04/`.
- The cleaned URL was verified with **HTTP 200**, banner **"no marker set"**,
  **5 jobs** and **zero scripts**.
- Removal of the old artifact and issue #7 tracking are handled by the coordinating
  worker, not by this documentation-only change.

The plan's `completed` status records the delivered work and the verified cleanup.
It does not assert that issue #8 is already closed: that issue remains pending
integration and push of this archival commit by the coordinating worker.
