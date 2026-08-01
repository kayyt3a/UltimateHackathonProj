// Loads .env.local into process.env for the standalone scripts.
//
// Next.js loads .env.local automatically, but these scripts run under tsx,
// which does not. Without this, putting the key in .env.local makes the dev
// server work while `seed:ledger` fails with a confusing auth error — the file
// is right there, just never read.
//
// Import this FIRST, before anything that constructs an Anthropic client.

import { existsSync, readFileSync } from "fs";
import path from "path";

const ENV_FILE = path.join(process.cwd(), ".env.local");

/**
 * Decodes the env file regardless of how Windows wrote it.
 *
 * On this platform `.env.local` routinely ends up UTF-16LE (PowerShell's `>`
 * redirect) or UTF-8-with-BOM (`Set-Content -Encoding utf8` on PS 5.1). Node's
 * built-in process.loadEnvFile() handles neither: UTF-16 parses as garbage, and
 * a UTF-8 BOM silently corrupts the FIRST variable's name into
 * "﻿ANTHROPIC_API_KEY". Both failures look identical from the outside —
 * the file is visibly correct in an editor while every consumer sees nothing.
 */
function decodeEnvFile(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return buf.subarray(2).swap16().toString("utf16le");
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  return buf.toString("utf8");
}

if (existsSync(ENV_FILE)) {
  for (const rawLine of decodeEnvFile(readFileSync(ENV_FILE)).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const name = line.slice(0, eq).trim();
    // Strip one layer of matching quotes, as dotenv-style files often carry them.
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");

    // Shell-set variables win, so `$env:ANTHROPIC_API_KEY = ...` still overrides.
    if (name && process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}

/**
 * Returns a human-readable problem with the API key, or null if it looks usable.
 * Never returns or logs the key itself.
 */
export function describeKeyProblem(): string | null {
  const key = process.env.ANTHROPIC_API_KEY;

  if (!key) {
    return (
      `ANTHROPIC_API_KEY is not set, and no value was found in .env.local.\n\n` +
      `Create the file in the project root:\n\n` +
      `    echo "ANTHROPIC_API_KEY=sk-ant-<your-real-key>" > .env.local\n`
    );
  }

  if (!key.startsWith("sk-ant-")) {
    return (
      `ANTHROPIC_API_KEY does not start with "sk-ant-", so it is probably not\n` +
      `an Anthropic API key. Check the value in .env.local.\n`
    );
  }

  // Length is the reliable tell — real keys are ~100 characters. Anything this
  // short is example text or a truncated paste, whatever it looks like.
  const MIN_PLAUSIBLE_KEY_LENGTH = 60;
  if (key.length < MIN_PLAUSIBLE_KEY_LENGTH) {
    return (
      `ANTHROPIC_API_KEY is only ${key.length} characters — real keys are around\n` +
      `100. This is placeholder text or a truncated paste.\n\n` +
      `Copy the FULL key from https://console.anthropic.com/settings/keys\n` +
      `into .env.local. (The value is not printed here.)\n`
    );
  }

  return null;
}
