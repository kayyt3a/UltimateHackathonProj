import { promises as fs } from "node:fs";
import path from "node:path";
import type { LedgerEntry } from "./types";

/**
 * Reads Person B's knowledge ledger.
 *
 * Resolution order:
 *   1. KNOWLEDGE_LEDGER_URL  — Person B's live endpoint, if they ship one
 *   2. KNOWLEDGE_LEDGER_PATH — explicit file override
 *   3. data/knowledge_ledger.json — the checked-in fixture
 *
 * Rows are passed through verbatim into `ledger_snapshot` so the ledger panel
 * renders whatever Person B ends up emitting; we only normalise enough to run
 * the disputed-entry check.
 */

const DEFAULT_PATH = path.join(process.cwd(), "data", "knowledge_ledger.json");

export async function readCurrentLedger(): Promise<LedgerEntry[]> {
  const url = process.env.KNOWLEDGE_LEDGER_URL;
  if (url) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return normalise(await res.json());
      console.warn(`[ledger] ${url} responded ${res.status}; falling back to file`);
    } catch (err) {
      console.warn(`[ledger] live endpoint unreachable, falling back to file:`, err);
    }
  }

  const filePath = process.env.KNOWLEDGE_LEDGER_PATH ?? DEFAULT_PATH;
  try {
    return normalise(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch (err) {
    console.warn(`[ledger] could not read ${filePath}:`, err);
    return [];
  }
}

/** Accepts either a bare array or `{ entries: [...] }` / `{ ledger: [...] }`. */
function normalise(payload: unknown): LedgerEntry[] {
  if (Array.isArray(payload)) return payload as LedgerEntry[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["entries", "ledger", "rows", "data"]) {
      if (Array.isArray(obj[key])) return obj[key] as LedgerEntry[];
    }
  }
  return [];
}
