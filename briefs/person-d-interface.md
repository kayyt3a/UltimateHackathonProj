# Person D — Login Screen + Interface

Paste everything below into a fresh Claude Code session.

---

PROJECT: "Cloudy's Second Opinion" — a hackathon tool for dragons sheltering in
Reid Library after an attack damaged the building's power, water and ventilation
systems. Their late engineer Cloudy left 5 handwritten notes describing failure
patterns; nobody ever connected them to the sensor data on his old computer. Five
AI agents each watch one pattern, and a sixth speaks in Cloudy's voice when
something is wrong.

Stack: Next.js (App Router) + TypeScript + Recharts.

I AM PERSON D. I own the login screen and the entire interface. The bar for the
main screen: a frightened, non-technical dragon opens it and knows what is wrong
in under five seconds.

=== SCREEN 1: LOGIN (/app/login/page.tsx) ===
The organizers require a login page, with NO authentication logic — no accounts,
no password checking, no backend. Any submission proceeds to the main screen.

Make it a narrative beat rather than a formality. The premise is that we are
booting up Cloudy's old computer, the machine nobody ever connected to his notes.
Style it as a worn CRT terminal from a building that has lost most of its power:

```
REID LIBRARY — ESSENTIAL SYSTEMS MONITOR
last login: 14 November 2025, 03:12
user: cloudy               <- pre-filled, non-editable, slightly faded
password: ••••••••         <- pre-filled, accepts anything, never validated
[ ENTER ]
```

A short boot sequence on submit sells it: a few lines of monospace text
appearing in sequence ("mounting sensor archive... 501 records"), then transition
to the main screen. Keep the whole thing under three seconds — it is a flourish,
not an obstacle. Add a skip affordance so we never get stuck on stage.
Store a trivial flag (sessionStorage or a query param) so the main page knows the
user came through it. No real auth, deliberately.

=== SCREEN 2: THE TOOL (/app/page.tsx) ===
One screen. No nav, no settings.

MY INPUT — GET /api/diagnose?ts=2026-07-05T06:00:00Z returns:
```json
{
  "severity": "amber",
  "watchers": [
    { "entry": "Entry 1", "status": "watching", "confidence": "high",
      "conflict": false, "conflict_note": null,
      "evidence": [ { "hour": "2026-07-05T04:00:00Z",
        "signal": "water_pressure_kpa", "value": 314.4, "baseline": 348,
        "source": "sensor" } ],
      "reasoning": "Pressure has fallen for four straight hours." },
    { "entry": "Entry 2", "status": "quiet", "confidence": "high", "conflict": false, "conflict_note": null, "evidence": [], "reasoning": "Sound events match vibration levels." },
    { "entry": "Entry 3", "status": "quiet", "confidence": "high", "conflict": false, "conflict_note": null, "evidence": [], "reasoning": "Power to airflow ratio sits within baseline." },
    { "entry": "Entry 4", "status": "quiet", "confidence": "high", "conflict": false, "conflict_note": null, "evidence": [], "reasoning": "Temperature still steady — not yet informative." },
    { "entry": "Entry 5", "status": "quiet", "confidence": "high", "conflict": false, "conflict_note": null, "evidence": [], "reasoning": "No gaps in this window." }
  ],
  "diagnosis": {
    "entry_cited": "Entry 1", "mode": "plumbing",
    "hours_to_failure_estimate": 6, "subsystem_scope": "water",
    "recommended_action": "Shut the west valve manually before the gauge reads critical.",
    "cloudy_quote": "Pressure's slid from 348 to 291 in six hours and the flow went with it. Same shape as always — don't wait for the valve to tell you.",
    "confidence": "high", "caveats": null
  },
  "tokens_used": 1850, "estimated_cost_usd": 0.0055
}
```
`diagnosis` is null when severity is "green". Hardcode this as a fixture and
build the whole UI against it before the real route exists.

Also available — Person A exports getWindow(timestamp, hoursBack) returning
`{ records: [...], baseline: { power_airflow_ratio: {mean, std}, ... } }`, where
each record carries timestamp, power_airflow_ratio and pressure_drop_rate_6h.

BUILD, top to bottom:

1. Traffic-light banner, full width. Green: a calm static line, "The library is
   breathing normally." Amber or red: diagnosis.cloudy_quote as the headline with
   recommended_action beneath. This banner alone carries 90% of the value.

2. Five rule-lights — one pill per Cloudy note, labelled by entry, coloured by
   status (quiet = muted, watching = amber, firing = red). Clicking a lit pill
   expands its reasoning and its evidence rows, rendering the actual numbers:
   signal name, observed value, baseline value, and source. Those numbers are how
   we prove the AI is citing evidence rather than guessing, so make them legible,
   not buried in small print.

   If a watcher has conflict: true, show a small "⚠ conflicting sources" badge
   on its pill. Expanding it should show conflict_note plainly — this is for a
   third organizer hint about a possible newly-recovered archive of old records
   that may contradict live sensor data. There's likely nothing to show here at
   first (conflict will always be false until that data exists), but the UI must
   already handle a true value cleanly, not crash or ignore it.

3. One chart — power_airflow_ratio and pressure_drop_rate_6h across the preceding
   48 hours, with baseline bands (mean ± std) shaded behind them. These two
   derived signals are the point: raw columns do not tell a story, derived ones
   do.

4. Replay scrubber — a slider across the July timeline. Dragging refetches
   /api/diagnose for that hour and re-renders everything. Debounce hard so
   dragging does not fire dozens of requests. Add quick-jump buttons for the four
   demo moments: 2026-07-04 23:00 (calm), 2026-07-05 06:00 (Entry 1 fires),
   2026-07-10 04:00 (Entry 3 fires — a different failure mode entirely),
   2026-07-15 06:00.

5. Token and cost counter, small, in a corner: "1,850 tokens · $0.006 today." It
   ties to the scenario — the dragons cannot afford one big brain, so they run
   five small ones.

6. A collapsed "How we know this" panel at the bottom. Person A is producing an
   analysis notebook with figures — the power-airflow regression, the sound
   versus vibration box plot, and a lead-time chart showing how many hours of
   advance warning each signal gives. Embed two or three of those PNGs here,
   collapsed by default so they never compete with the five-second read. The
   organizers explicitly want our data-science method visible; this is where it
   lives in the product, and it gives us something to open on stage.

FALLBACK — wrap every fetch in try/catch falling back to a cached response for
that timestamp (Person C pre-warms those cache files). If the network stalls on
stage the page must still move. Never show a spinner that outlives a heartbeat.

VISUAL TONE — a scored differentiator, not decoration. The login screen is the
one deliberate exception: dark CRT terminal, monospace, phosphor green.
Everything after it is the opposite — warm cream or off-white, never dark mode.
A serif or handwritten-adjacent face for Cloudy's quotes; clean sans-serif
elsewhere for legibility. Soft edges, generous spacing, no glassmorphism, no
neon, no gradients. It should read like a well-worn logbook or a note taped to a
wall — the deliberate opposite of the enterprise dashboards every other team
will ship. The contrast between the cold terminal and the warm logbook is the
point: you boot his machine, and then his voice comes through.

DELIVERABLE: login screen with boot sequence and skip path; the full single-page
tool working against the fixture with all three severity states tested by
swapping it; the conflict badge rendering correctly when tested with a
hand-edited fixture where conflict: true; the chart plotting real data from
getWindow(); scrubber and quick-jump buttons wired; the analysis panel embedding
Person A's figures; cache fallback in place. Swapping the fixture for a live
fetch should be a one-line change.
