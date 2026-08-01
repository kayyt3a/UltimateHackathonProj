// Live reconciliation endpoint. Person D's "new information just arrived"
// text box calls this directly.
//
// POST { "source_label": "...", "text": "..." }
//   -> runs the Reconciliation Agent against the current ledger + stats
//   -> appends the returned row to data/knowledge_ledger.json
//   -> returns { row, ledger_size }
//
// GET -> { ledger } so the panel can render the current state on load.

import { NextRequest, NextResponse } from "next/server";
import { reconcileClaim } from "@/lib/reconcile";
import { getStatsForClaim } from "@/lib/stats";
import { appendLedgerRow, readLedger } from "@/lib/ledger-store";
import { ReconcileRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const ledger = await readLedger();
  return NextResponse.json({ ledger });
}

export async function POST(request: NextRequest) {
  let body: ReconcileRequest;
  try {
    body = (await request.json()) as ReconcileRequest;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const sourceLabel = typeof body.source_label === "string" ? body.source_label.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!sourceLabel || !text) {
    return NextResponse.json(
      { error: 'Both "source_label" and "text" are required and must be non-empty strings.' },
      { status: 400 }
    );
  }

  // Cap input size. A pasted 200-page PDF would blow past the context window
  // and cost, and the failure would land mid-demo.
  const MAX_TEXT_CHARS = 8000;
  const MAX_LABEL_CHARS = 200;
  if (text.length > MAX_TEXT_CHARS || sourceLabel.length > MAX_LABEL_CHARS) {
    return NextResponse.json(
      {
        error: `Too long: "text" must be under ${MAX_TEXT_CHARS} characters (got ${text.length}) and "source_label" under ${MAX_LABEL_CHARS} (got ${sourceLabel.length}).`,
      },
      { status: 400 }
    );
  }

  const ledger = await readLedger();
  const id = `live_${Date.now()}`;

  try {
    // getStatsForClaim() with no entry key returns the dataset-wide stats,
    // which is what a novel live claim gets — we don't know in advance which
    // entry it touches, so the agent sees the general picture.
    const row = await reconcileClaim(id, sourceLabel, text, getStatsForClaim(), ledger);
    const updated = await appendLedgerRow(row);
    return NextResponse.json({ row, ledger_size: updated.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Reconciliation failed:", message);
    return NextResponse.json({ error: `Reconciliation failed: ${message}` }, { status: 502 });
  }
}
