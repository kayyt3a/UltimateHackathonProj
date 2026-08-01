# Person D — Login Screen + Interface

Paste everything below into a fresh Claude Code session.

---

PROJECT: "Cloudy's Second Opinion" — Reid Library's late engineer Cloudy left 5
handwritten notes describing failure patterns; nobody ever connected them to
his sensor data. Four deterministic watchers detect the patterns instantly, a
Voice agent speaks as Cloudy when something's wrong, and a Reconciliation
Agent tests any new document — live, on the spot — against everything already
verified, showing agreement or disagreement instead of silently picking a
winner.

Stack: Next.js (App Router) + TypeScript + Recharts.

I AM PERSON D. I own the login screen and the entire interface. The bar: a
frightened, non-technical dragon opens this page and knows what's wrong in
under five seconds.

=== SCREEN 1: LOGIN (/app/login/page.tsx) ===
Organizers require a login page, NO authentication logic — no accounts, no
password checking. Any submission proceeds to the main screen.

Frame it as booting Cloudy's old computer — the machine nobody ever connected
to his notes. Dark CRT terminal aesthetic, monospace, phosphor green:

```
REID LIBRARY — ESSENTIAL SYSTEMS MONITOR
last login: 14 November 2025, 03:12
user: cloudy               <- pre-filled, non-editable, slightly faded
password: ••••••••         <- pre-filled, accepts anything, never validated
[ ENTER ]
```

A short boot sequence on submit sells it: a few lines of monospace text
appearing in sequence ("mounting sensor archive... 501 records", "loading
knowledge ledger... 5 entries"), then transition to the main screen. Keep it
under three seconds — a flourish, not an obstacle. Add a skip affordance so we
never get stuck on stage. This screen is the ONE deliberate exception to the
warm visual tone below — everything after it flips to warm and low-tech,
which is the point: you boot his cold machine, then his voice comes through.

=== SCREEN 2: THE TOOL (/app/page.tsx) ===
One screen. No nav, no settings.

MY INPUT — GET /api/diagnose?ts=2026-07-05T06:00:00Z returns:
```json
{
  "severity": "amber",
  "watchers": [
    { "entry": "Entry 1", "status": "watching", "subsystem": "water",
      "evidence": [ { "hour": "2026-07-05T04:00:00Z",
        "signal": "pressure_slope_6h", "value": -9.4, "threshold": -5 } ],
      "reasoning": "Pressure has fallen at 9.4 kPa/h for the last 3 hours." },
    { "entry": "Entry 3", "status": "quiet", "subsystem": "ventilation", "evidence": [], "reasoning": "Residual within healthy band." },
    { "entry": "Entry 4", "status": "quiet", "subsystem": null, "evidence": [], "reasoning": "No degradation to compare temperature against yet." },
    { "entry": "Entry 5", "status": "quiet", "subsystem": null, "evidence": [], "reasoning": "Calibration nominal, no gap clustering." }
  ],
  "listener_validation": { "entry": "Entry 2", "accuracy_vs_system_status": 1.0,
    "note": "The young dragons' ears are exactly as accurate as the sensors — never earlier, never later." },
  "diagnosis": {
    "entry_cited": "Entry 1", "subsystem_scope": "water", "mode": "plumbing",
    "headline": "Pressure falling, pipes complaining",
    "recommended_action": "Shut the west valve manually before the gauge reads critical.",
    "reasoning": "Pressure's slid steadily for four hours — same shape as always, Cloudy would say. This is the pipes complaining before the valve fails.",
    "predicted_to_escalate": true,
    "escalation_basis": "Pressure has fallen 9.4 kPa/h for 3 hours; this pattern preceded total failure in both past water faults.",
    "hours_to_critical_estimate": 8,
    "speech_text": "Pressure is dropping fast. Both times we've seen this pattern before, it ended in total failure within about eight hours.",
    "confidence": "moderate", "caveat": "Based on only two past water faults — treat as a strong hint, not a certainty."
  },
  "ledger_snapshot": [
    { "id": "entry_1", "source_label": "Cloudy's notes — Entry 1", "claim": "Pressure/flow degrade before valve failure.", "verdict": "supported", "evidence": "pressure_slope_6h < -5 sustained 3h, validated on 2 episodes", "conflicts_with": null, "data_leans_toward": null, "note_to_dragons": "Trust a falling gauge before the valve fails." }
  ],
  "tokens_used": 850, "estimated_cost_usd": 0.003
}
```
`diagnosis` is null when severity is "green". Hardcode this as a fixture and
build the whole UI against it before the real route exists.

Also available — Person A exports getWindow(timestamp, hoursBack) returning
`{ records: [...], baseline: {...} }`, each record carrying timestamp,
residual and pressure_slope_6h — use for the chart.

BUILD, top to bottom:

1. **Traffic-light banner**, full width. Green: calm static line, "The library
   is breathing normally." Amber/red: diagnosis.headline as the big text,
   diagnosis.recommended_action beneath it. This carries 90% of the value.

2. **Escalation badge + spoken announcement.** When
   `diagnosis.predicted_to_escalate === true`, show a pulsing "likely
   escalating" badge next to the banner (amber only — never appears alongside
   a fresh green→amber transition, only when Entry 1's escalation rule is
   active) and call browser text-to-speech with `diagnosis.speech_text`:
   ```js
   function announce(speechText) {
     const utterance = new SpeechSynthesisUtterance(speechText);
     utterance.rate = 0.95;
     window.speechSynthesis.speak(utterance);
   }
   ```
   Free, instant, no new backend — the LLM already wrote the sentence, this
   just reads it aloud. **The banner colour must stay Amber while this plays
   — never jump to Red early.** This is a hard rule; violating it is the same
   category of error as hallucinating green during an emergency.

3. **Four active rule-lights** — one pill per Entry 1/3/4/5, coloured by
   status (quiet=muted, watching=amber, firing=red). Click to expand
   `reasoning` and the `evidence` array's actual numbers (signal, value,
   threshold) — this is how we prove the system cites evidence, not vibes.
   Entry 4's "firing" state should render distinctly (a neutral/blue tone, not
   red) since its meaning is "we confirmed no lag exists," not "danger."

4. **"The listeners, scored" panel** — separate from the four rule-lights,
   rendering `listener_validation`. This is Entry 2, deliberately excluded
   from severity. Show it as a small confusion-matrix or accuracy stat, framed
   positively: "the young dragons' ears are exactly as reliable as the
   sensors." Never let this panel affect the banner colour.

5. **One chart** — residual and pressure_slope_6h over the preceding 48 hours,
   baseline bands (mean ± std) shaded. Only possible to scrub live because
   detection is arithmetic, not LLM calls.

6. **Replay scrubber** across the July timeline, debounced, plus quick-jump
   buttons: 2026-07-04 23:00 (calm), 2026-07-05 04:00 (Entry 1 fires),
   2026-07-06 00:00 (failure), 2026-07-10 06:00 (Entry 3 fires — different
   failure mode entirely).

7. **Knowledge ledger panel** — renders `ledger_snapshot`. Every claim ever
   tested, any source, with a verdict badge: ✓ supported · ✗ refuted ·
   ? untestable · **⚠ disputed**. Disputed rows are visually distinct (amber,
   expandable) and show `claim` and `conflicts_with`'s claim side by side,
   plus `data_leans_toward` if present — never silently pick a winner.

8. **"New information just arrived" panel** — a text box (accepts paste and
   free typing, not file upload only — you won't have time to convert a photo
   into a file if a judge hands us a physical document). On submit, POST to
   `/api/reconcile` (Person B owns this endpoint — coordinate directly with
   them on the request/response shape):
   ```
   POST /api/reconcile { "source_label": "...", "text": "..." }
   -> returns the new ledger row, which you append to the ledger panel live
   ```
   If the new row's `verdict` is `disputed` or conflicts with an existing
   entry, surface that prominently the moment it appears — this is the direct
   answer to the guaranteed judging question, demoed live, so it needs to be
   visually unmissable, not a quiet log line.

9. **Token/cost counter**, small, in a corner: "850 tokens · $0.003 today."

10. **Collapsed "How we know this" panel** at the bottom — embed 2-3 PNGs from
    Person A's analysis notebook (the calibration fix, the regression/residual
    chart, the escalation lead-time chart), collapsed by default so they never
    compete with the five-second read. This is where the required
    data-science visualisation lives in the product itself.

FALLBACK — wrap every fetch in try/catch falling back to a cached response for
that timestamp (Person C pre-warms those files). Never show a spinner that
outlives a heartbeat.

VISUAL TONE — a scored differentiator, not decoration. Login screen: dark CRT
terminal, monospace, phosphor green (the one exception). Everything after:
warm cream/off-white, never dark mode, serif or handwritten-adjacent face for
Cloudy's quotes, clean sans-serif elsewhere, soft edges, generous spacing, no
glassmorphism, no neon, no gradients. A well-worn logbook, not an enterprise
dashboard.

DELIVERABLE: login screen with boot sequence and skip path; the full
single-page tool working against the fixture with all three severity states
tested by swapping it; the escalation badge + TTS wired and confirmed to never
advance the banner colour early; the "listeners, scored" panel rendering
correctly; the chart plotting real data from getWindow(); scrubber and
quick-jump buttons wired; the knowledge ledger panel with at least one hand-
edited `disputed` fixture tested; the live-ingest panel wired to Person B's
`/api/reconcile`; the analysis panel embedding Person A's figures; cache
fallback in place. Swapping fixtures for live fetches should be one-line
changes throughout.
