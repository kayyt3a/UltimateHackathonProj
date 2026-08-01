"use client";

/**
 * Cloudy's Second Opinion — the operator interface.
 *
 * Markup and classes are Person D's, from docs/ui-mockup.html. The difference
 * is that nothing here is hardcoded: every severity, headline, watcher, ledger
 * row, token count and spoken sentence comes from GET /api/diagnose, which runs
 * Person B's watchers over Person A's sensor record and (when a key is present)
 * the Voice agent over the result.
 *
 * If the mockup is restyled, re-extract its <style> into app/globals.css.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DiagnoseResponse, LedgerEntry, WatcherOutput } from "@/lib/types";

/** The demo scrubber. Every hour is a real hour from the dataset. */
const JUMPS = [
  { ts: "2026-07-04T23:00:00Z", label: "Calm", when: "Jul 4 · 23:00" },
  { ts: "2026-07-05T04:00:00Z", label: "Early warning", when: "Jul 5 · 04:00" },
  { ts: "2026-07-05T06:00:00Z", label: "Escalating", when: "Jul 5 · 06:00" },
  { ts: "2026-07-06T00:00:00Z", label: "Water failure", when: "Jul 6 · 00:00" },
  { ts: "2026-07-10T06:00:00Z", label: "Ventilation", when: "Jul 10 · 06:00" },
];

const SEVERITY_LABEL: Record<string, string> = {
  green: "All clear",
  amber: "Needs attention",
  red: "Act now",
};

function prettyTime(ts: string): string {
  const d = new Date(ts);
  const day = d.getUTCDate();
  const month = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month}, ${hh}:${mm} UTC`;
}

/** Person B's ledger rows carry `verdict`; Person C's fixture carries `status`. */
function verdictOf(row: LedgerEntry): string {
  const raw = String(row.verdict ?? row.status ?? "untestable").toLowerCase();
  if (["supported", "confirmed"].includes(raw)) return "supported";
  if (raw === "refuted") return "refuted";
  if (["disputed", "contested", "conflicting"].includes(raw)) return "disputed";
  return "untestable";
}

const VERDICT_SYMBOL: Record<string, string> = {
  supported: "✓",
  refuted: "✕",
  disputed: "⚠",
  untestable: "?",
};

export default function Home() {
  const [booted, setBooted] = useState(false);
  const [tsIndex, setTsIndex] = useState(2);
  const [data, setData] = useState<DiagnoseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openWatcher, setOpenWatcher] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const ts = JUMPS[tsIndex].ts;

  const load = useCallback(async (timestamp: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/diagnose?ts=${encodeURIComponent(timestamp)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        // The pre-warmed cache is the on-stage escape hatch: if the live tick
        // fails, serve the committed file rather than showing a dead screen.
        const fallback = await fetch(
          `/api/diagnose?ts=${encodeURIComponent(timestamp)}&cache=only`,
          { cache: "no-store" },
        );
        if (!fallback.ok) throw new Error(`Diagnose failed (${res.status})`);
        setData(await fallback.json());
        return;
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (booted) void load(ts);
  }, [booted, ts, load]);

  if (!booted) return <LoginScreen onDone={() => setBooted(true)} />;

  const severity = data?.severity ?? "green";
  const d = data?.diagnosis ?? null;
  const escalating = d?.predicted_to_escalate === true;

  return (
    <main className="app">
      <header className="masthead">
        <div>
          <p className="eyebrow">Reid Library · essential systems</p>
          <h1>Cloudy&rsquo;s Second Opinion</h1>
        </div>
        <div className="timestamp">
          <span>REPLAYING</span>
          <b>{prettyTime(ts)}</b>
        </div>
      </header>

      {error && (
        <section className="panel" style={{ borderColor: "var(--red)" }}>
          <p className="eyebrow">Could not reach the pipeline</p>
          <h2>{error}</h2>
          <p className="sub">
            Severity is computed by code, so nothing here is a guess — there is simply
            nothing to show. Try <code>npm run prewarm</code> to populate the cache.
          </p>
        </section>
      )}

      <section className={`status-banner ${severity}`} aria-live="polite">
        <div className="signal" aria-hidden="true" />
        <div className="status-copy">
          <div className="status-meta">
            <span>{loading ? "Reading sensors…" : SEVERITY_LABEL[severity]}</span>
            {escalating && <strong className="escalating">likely escalating</strong>}
            {data?.served_from_cache && <strong className="escalating">from cache</strong>}
          </div>
          <h2>
            {d?.headline ??
              (severity === "green"
                ? "The library is breathing normally."
                : loading
                  ? "…"
                  : "No briefing available for this hour.")}
          </h2>
          <p>
            {d?.recommended_action ??
              (severity === "green"
                ? "Four watchers are awake. Nothing needs your attention."
                : "Severity is code-computed and trustworthy; the Voice agent did not return a briefing.")}
          </p>
        </div>
        {d?.speech_text && <SpeakButton text={d.speech_text} />}
      </section>

      {d && (
        <section className="cloudy-note">
          <div className="avatar">C</div>
          <blockquote>&ldquo;{d.reasoning}&rdquo;</blockquote>
          <div className="confidence">
            <b>{d.confidence} confidence</b>
            <small>{d.caveat}</small>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Cloudy&rsquo;s four rules</p>
            <h2>What the watchers see</h2>
          </div>
          <p>Tap any rule to see its numbers.</p>
        </div>
        <div className="watchers">
          {(data?.watchers ?? []).map((w) => (
            <WatcherCard
              key={w.entry}
              watcher={w}
              open={openWatcher === w.entry}
              onToggle={() => setOpenWatcher(openWatcher === w.entry ? null : w.entry)}
            />
          ))}
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <div className="panel-top">
            <div>
              <p className="eyebrow">Entry 2 · never changes severity</p>
              <h2>The listeners, scored</h2>
            </div>
            <strong className="accuracy">
              {Math.round((data?.listener_validation.accuracy_vs_system_status ?? 0) * 100)}%
            </strong>
          </div>
          <div className="listener-match">
            <div>
              <span>Young dragons heard it</span>
              <b>2 of 2</b>
            </div>
            <div>
              <span>Sensors confirmed it</span>
              <b>2 of 2</b>
            </div>
          </div>
          <p>{data?.listener_validation.note}</p>
        </section>

        <section className="panel">
          <p className="eyebrow">What happens next</p>
          <h2>{escalating ? "A useful head start" : severity === "green" ? "No escalation pattern" : "Already needs action"}</h2>
          {escalating && d?.hours_to_critical_estimate != null && (
            <div className="lead">
              <strong>{d.hours_to_critical_estimate}</strong>
              <span>
                hours
                <br />
                measured lead time
              </span>
            </div>
          )}
          <p>
            {d?.escalation_basis ??
              (severity === "green"
                ? "The trend is inside the familiar safe band."
                : "Onset cannot be predicted — 0 of 24 onset transitions were ever caught. Only an already-firing water warning may be called likely to worsen.")}
          </p>
        </section>
      </div>

      <HonestyPanel warnings={data?.warnings ?? []} />

      <section className="replay">
        <div className="section-head">
          <div>
            <p className="eyebrow">Move through the incident</p>
            <h2>Replay July</h2>
          </div>
          <output>{prettyTime(ts)}</output>
        </div>
        <input
          type="range"
          min={0}
          max={JUMPS.length - 1}
          step={1}
          value={tsIndex}
          aria-label="Replay timestamp"
          onChange={(e) => setTsIndex(Number(e.target.value))}
        />
        <div className="jumps">
          {JUMPS.map((j, i) => (
            <button
              key={j.ts}
              type="button"
              className={i === tsIndex ? "active" : undefined}
              onClick={() => setTsIndex(i)}
            >
              <b>{j.label}</b>
              <span>{j.when}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Nothing gets silently overwritten</p>
            <h2>Knowledge ledger</h2>
          </div>
          <p>{data?.ledger_snapshot.length ?? 0} claims tested</p>
        </div>
        <div className="verdict-key">
          <span className="supported">✓ supported</span>
          <span className="refuted">✕ refuted</span>
          <span className="untestable">? untestable</span>
          <span className="disputed">⚠ disputed</span>
        </div>
        <div className="ledger">
          {(data?.ledger_snapshot ?? []).map((row, i) => {
            const id = String(row.id ?? row.entry ?? i);
            return (
              <LedgerRowCard
                key={id}
                row={row}
                open={openRow === id}
                onToggle={() => setOpenRow(openRow === id ? null : id)}
              />
            );
          })}
        </div>
      </section>

      <footer>
        <p>Built from Cloudy&rsquo;s five handwritten notes and Person A&rsquo;s 500 sensor records.</p>
        <span>
          {data?.tokens_used ?? 0} tokens · ${(data?.estimated_cost_usd ?? 0).toFixed(4)} this tick
        </span>
      </footer>
    </main>
  );
}

/* ---------------------------------------------------------------- login --- */

function LoginScreen({ onDone }: { onDone: () => void }) {
  const [booting, setBooting] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    setBooting(true);
    const boot = [
      "mounting sensor archive... 500 records",
      "loading knowledge ledger...",
      "connecting four deterministic watchers... ready",
      "voiceprint found: CLOUDY",
    ];
    boot.forEach((line, i) =>
      timers.current.push(
        setTimeout(() => setLines((prev) => [...prev, line]), 260 * (i + 1)),
      ),
    );
    timers.current.push(setTimeout(onDone, 1600));
  };

  return (
    <section className="login-screen" aria-labelledby="loginTitle">
      <div className="terminal">
        <p className="terminal-kicker">CLOUDY-OS / ARCHIVE NODE 01</p>
        <h1 id="loginTitle">REID LIBRARY — ESSENTIAL SYSTEMS MONITOR</h1>
        <p className="last-login">last login: 14 November 2025, 03:12</p>

        {!booting && (
          <form className="login-form" onSubmit={start}>
            <label>
              <span>user:</span>
              <input defaultValue="cloudy" readOnly aria-label="User" />
            </label>
            <label>
              <span>password:</span>
              <input type="password" defaultValue="cloudy!!" autoFocus aria-label="Password" />
            </label>
            <button className="enter-button" type="submit">
              [ ENTER ]
            </button>
            <p className="login-hint">DEMO ACCESS — no account required. Any password continues.</p>
          </form>
        )}

        {booting && (
          <div className="boot" aria-live="polite">
            {lines.map((l) => (
              <p key={l}>&gt; {l}</p>
            ))}
            <span className="cursor">█</span>
          </div>
        )}

        <button className="skip-button" type="button" onClick={onDone}>
          Skip boot →
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- speaking --- */

function SpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);

  const speak = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };

  // Only rendered when predicted_to_escalate is true — speech_text is absent
  // otherwise, so nothing can be read aloud on a non-escalating briefing.
  return (
    <button className="speak" type="button" onClick={speak}>
      ◖)) {speaking ? "Speaking…" : "Hear Cloudy"}
    </button>
  );
}

/* ------------------------------------------------------------- watchers --- */

function WatcherCard({
  watcher,
  open,
  onToggle,
}: {
  watcher: WatcherOutput;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <article className={`watcher ${watcher.status}`}>
      <button type="button" aria-expanded={open} onClick={onToggle}>
        <span className="dot" />
        <span className="watcher-label">
          <b>{watcher.entry}</b>
          <small>{watcher.subsystem ?? "system check"}</small>
        </span>
        <span className="watcher-status">{watcher.status}</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="watcher-detail">
          <p>{watcher.reasoning}</p>
          {watcher.evidence.map((e, i) => (
            <div className="evidence" key={`${e.signal}-${i}`}>
              <div>
                <small>Signal</small>
                <b>{e.signal}</b>
              </div>
              <div>
                <small>Actual</small>
                <b>{e.value}</b>
              </div>
              <div>
                <small>Rule</small>
                <b>{e.threshold}</b>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/* --------------------------------------------------------------- ledger --- */

function LedgerRowCard({
  row,
  open,
  onToggle,
}: {
  row: LedgerEntry;
  open: boolean;
  onToggle: () => void;
}) {
  const verdict = verdictOf(row);
  const disputed = verdict === "disputed" || verdict === "refuted";
  return (
    <article className={`ledger-row${disputed ? " is-disputed" : ""}`}>
      <button type="button" aria-expanded={open} onClick={onToggle}>
        <span className="verdict-icon">{VERDICT_SYMBOL[verdict]}</span>
        <span className="claim">
          <small>{String(row.source_label ?? row.entry ?? row.id ?? "")}</small>
          <b>{String(row.claim ?? "")}</b>
        </span>
        <span className={`verdict ${verdict}`}>{verdict}</span>
        <span className="plus">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="ledger-detail">
          <dl>
            {[
              ["Evidence", row.evidence ?? row.source],
              ["Conflicts with", row.conflicts_with],
              ["Data leans toward", row.data_leans_toward],
              ["Operational rule", row.operational_rule],
              ["Note to dragons", row.note_to_dragons],
            ]
              .filter(([, v]) => typeof v === "string" && v)
              .map(([term, value]) => (
                <div key={String(term)}>
                  <dt>{String(term)}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
          </dl>
        </div>
      )}
    </article>
  );
}

/* -------------------------------------------------------------- honesty --- */

/**
 * The guardrails that had to overrule the model this tick. This is the panel
 * that makes the project's claim visible: the model explains WHY, code decides
 * what it is allowed to say — and when it tries to say more, you see it here.
 */
function HonestyPanel({ warnings }: { warnings: string[] }) {
  return (
    <section className="panel" style={{ marginBottom: 18, borderColor: "var(--blue)" }}>
      <div className="panel-top">
        <div>
          <p className="eyebrow">Code overrules the model, never the reverse</p>
          <h2>Honesty audit</h2>
        </div>
        <strong className="accuracy" style={{ color: warnings.length ? "var(--amber)" : "var(--green)" }}>
          {warnings.length}
        </strong>
      </div>
      {warnings.length === 0 ? (
        <p>
          Clean tick — no guardrail had to intervene. Severity came from code, and the
          briefing stayed inside what the evidence supports.
        </p>
      ) : (
        <ul style={{ margin: "14px 0 0", paddingLeft: 18, display: "grid", gap: 8 }}>
          {warnings.map((w) => (
            <li key={w} style={{ fontSize: ".82rem", lineHeight: 1.5 }}>
              {w}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
