# Cloudy's Second Opinion

Next.js App Router project. The analysis pipeline that feeds it lives one level
up, in the repository root.

## Layout

```
UltimateHackathonProj/
├── prepare_data.py          <- Person A's pipeline (run from the repo root)
├── prepared_data.json       <- its output; the single source of truth
├── reid_library_sensor_data.csv
└── ClaudeHackathon/         <- this Next.js project
    ├── lib/data.ts          <- reads ../prepared_data.json, no math
    ├── app/api/data/        <- server-side door onto that data
    └── tests/               <- vitest
```

## Commands

| command | what it does |
| --- | --- |
| `npm run dev` | Next dev server |
| `npm run build` | production build (also typechecks) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | full vitest suite |
| `npm run test:data` | just the data access layer tests |
| `npm run test:watchers` | Person B's watcher fixture harness |
| `npm run data:refresh` | regenerate `../prepared_data.json` from the CSV |

## Regenerating the data

`prepared_data.json` is a build artefact of `prepare_data.py`, not something to
hand-edit. **If `reid_library_sensor_data.csv` changes for any reason, nothing
downstream is trustworthy until the JSON is regenerated:**

```bash
npm run data:refresh     # == cd .. && python3 prepare_data.py
npm test                 # confirms the regenerated file still holds
```

Every derived number the app displays — the regression fit, the Barry J
calibration offsets, the ventilation threshold, the escalation rule, the
episode list, the GMM novelty threshold — is computed once in Python and read
back out of that JSON. Nothing is recomputed in TypeScript, so a stale JSON
shows stale numbers everywhere at once and silently.

## Reading the data (`lib/data.ts`)

```ts
import {
  loadAllRecords,      // all 500 hourly records, ascending
  getWindow,           // (timestamp, hoursBack = 12) -> { records, baseline }
  getRecordAt,         // nearest record at or before a timestamp, else null
  getBaseline,         // mean/std for residual, water_pressure_kpa, vibration_level
  getDerivedConstants, // every threshold and fitted constant
  getTimestampRange,   // { min, max } for the scrubber bounds
} from "@/lib/data";
```

**Server-side only.** This module uses `fs`, `path` and `process.cwd()`, so it
may only be imported from Route Handlers (`app/api/**/route.ts`) and Server
Components. A `"use client"` file must fetch from `/api/data` (or Person C's
route) instead — `tests/client-boundary.test.ts` fails the build if anything
crosses that line.

`prepared_data.json` is located by trying, in order,
`./prepared_data.json`, `../prepared_data.json`, `./data/prepared_data.json`
relative to `process.cwd()`. In this repo the second one hits. If the app is
ever started from a different directory, add that path to the candidate list in
`loadRaw()` rather than moving the file.

## `/api/data`

| request | response |
| --- | --- |
| `GET /api/data` | `{ range, count, baseline, derived_constants }` |
| `GET /api/data?timestamp=…` | `{ record }` at or before that hour |
| `GET /api/data?timestamp=…&hours_back=48` | `{ records, baseline }` |

Bad timestamps and non-positive `hours_back` return `400`; a missing or
unreadable `prepared_data.json` returns `500` with the loader's message rather
than pretending the library is fine.
