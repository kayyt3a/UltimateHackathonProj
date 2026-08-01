import { NextResponse } from "next/server";
import { diagnose } from "@/lib/diagnose";
import { readCache } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PART 3 — GET /api/diagnose?ts=2026-07-05T06:00:00Z
 *
 * Returns the locked response contract Person D builds against:
 *
 *   {
 *     "severity": "amber",
 *     "watchers": [ /* 4 objects, passed through untouched *\/ ],
 *     "listener_validation": { ... },
 *     "diagnosis": { /* voice output, or null when green *\/ },
 *     "ledger_snapshot": [ ... ],
 *     "tokens_used": 850,
 *     "estimated_cost_usd": 0.003
 *   }
 *
 * `?cache=only` serves the pre-warmed cache file without making a live call —
 * the on-stage escape hatch if the network is slow.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ts = url.searchParams.get("ts") ?? new Date().toISOString();

  if (Number.isNaN(Date.parse(ts))) {
    return NextResponse.json(
      { error: `Invalid ts parameter: ${ts}. Expected an ISO 8601 timestamp.` },
      { status: 400 },
    );
  }

  if (url.searchParams.get("cache") === "only") {
    const cached = await readCache(ts);
    if (!cached) {
      return NextResponse.json(
        { error: `No cached response for ${ts}. Run \`npm run prewarm\` first.` },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { ...cached, served_from_cache: true },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const response = await diagnose(ts);
  return NextResponse.json(response, {
    headers: { "cache-control": "no-store" },
  });
}
