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

export interface LedgerRead {
  ledger: LedgerEntry[];
  /**
   * Non-empty when the ledger could not be loaded. An empty ledger and a
   * FAILED ledger look identical downstream — both yield "no relevant entry is
   * disputed" — so the failure has to be reported, or the Voice agent claims
   * certainty on knowledge it never actually read.
   */
  problems: string[];
}

export async function readCurrentLedgerChecked(): Promise<LedgerRead> {
  const problems: string[] = [];

  const url = process.env.KNOWLEDGE_LEDGER_URL;
  if (url) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return { ledger: normalise(await res.json()), problems };
      problems.push(`Knowledge ledger endpoint responded ${res.status}; fell back to the local file.`);
    } catch (err) {
      problems.push(
        `Knowledge ledger endpoint unreachable (${err instanceof Error ? err.message : String(err)}); fell back to the local file.`,
      );
    }
  }

  const filePath = process.env.KNOWLEDGE_LEDGER_PATH ?? DEFAULT_PATH;
  try {
    const ledger = normalise(JSON.parse(await fs.readFile(filePath, "utf8")));
    // A live-endpoint failure that the file covered is not worth alarming about.
    return { ledger, problems: url && ledger.length > 0 ? [] : problems };
  } catch (err) {
    problems.push(
      `Knowledge ledger could not be read (${err instanceof Error ? err.message : String(err)}). ` +
        `Treat "no disputed entries" as unknown this tick, not as agreement.`,
    );
    return { ledger: [], problems };
  }
}

/**
 * Soft read — never throws, never reports. The ledger must not be a hard
 * dependency of the traffic light. Use `readCurrentLedgerChecked` where the
 * distinction between "empty" and "unreadable" matters.
 */
export async function readCurrentLedger(): Promise<LedgerEntry[]> {
  return (await readCurrentLedgerChecked()).ledger;
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
