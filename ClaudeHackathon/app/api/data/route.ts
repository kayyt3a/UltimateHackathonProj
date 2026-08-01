// Person A — the server-side door onto prepared_data.json.
//
// lib/data.ts uses `fs`, so it can only be imported from Route Handlers and
// Server Components. Anything marked "use client" (Person D's chart, the
// scrubber) must come through here instead of importing lib/data.ts directly.
//
// GET /api/data                                  -> { range, count, baseline, derived_constants }
// GET /api/data?timestamp=...                    -> { record } at or before that hour
// GET /api/data?timestamp=...&hours_back=48      -> { records, baseline } window
//
// No math happens here. Every number is read straight out of prepared_data.json
// exactly as prepare_data.py wrote it.

import { NextRequest, NextResponse } from "next/server";
import {
  getBaseline,
  getDerivedConstants,
  getRecordAt,
  getTimestampRange,
  getWindow,
  loadAllRecords,
} from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const timestamp = params.get("timestamp");
  const hoursBackRaw = params.get("hours_back");

  try {
    if (!timestamp) {
      // Metadata call — used to populate the scrubber's bounds and to give the
      // UI every threshold it needs without hardcoding one.
      return NextResponse.json({
        range: getTimestampRange(),
        count: loadAllRecords().length,
        baseline: getBaseline(),
        derived_constants: getDerivedConstants(),
      });
    }

    if (Number.isNaN(new Date(timestamp).getTime())) {
      return NextResponse.json(
        { error: `"timestamp" is not a parseable date: ${timestamp}` },
        { status: 400 }
      );
    }

    if (hoursBackRaw === null) {
      return NextResponse.json({ record: getRecordAt(timestamp) });
    }

    const hoursBack = Number(hoursBackRaw);
    if (!Number.isFinite(hoursBack) || hoursBack <= 0) {
      return NextResponse.json(
        { error: `"hours_back" must be a positive number, got: ${hoursBackRaw}` },
        { status: 400 }
      );
    }

    return NextResponse.json(getWindow(timestamp, hoursBack));
  } catch (err) {
    // The one failure mode worth surfacing loudly: prepared_data.json missing
    // or unreadable from wherever the app was started. Silent empty data here
    // would look like "the library is fine" — which is the opposite of true.
    const message = err instanceof Error ? err.message : String(err);
    console.error("lib/data.ts failed to load prepared_data.json:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
