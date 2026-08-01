// Read/write helpers for data/knowledge_ledger.json. Shared by the offline
// seed script and the live /api/reconcile endpoint so both write through the
// same file in the same shape.

import { promises as fs } from "fs";
import path from "path";
import { LedgerRow } from "./types";

const LEDGER_PATH = path.join(process.cwd(), "data", "knowledge_ledger.json");

export async function readLedger(): Promise<LedgerRow[]> {
  try {
    const raw = await fs.readFile(LEDGER_PATH, "utf-8");
    return JSON.parse(raw) as LedgerRow[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function writeLedger(rows: LedgerRow[]): Promise<void> {
  await fs.mkdir(path.dirname(LEDGER_PATH), { recursive: true });
  await fs.writeFile(LEDGER_PATH, JSON.stringify(rows, null, 2) + "\n", "utf-8");
}

export async function appendLedgerRow(row: LedgerRow): Promise<LedgerRow[]> {
  const rows = await readLedger();
  rows.push(row);
  await writeLedger(rows);
  return rows;
}

export { LEDGER_PATH };
