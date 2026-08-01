# Rehearsal document 2 — the one that should be SUPPORTED

**Fictional.** Paired with `refuting-note.md` so the demo shows both outcomes:
the agent can confirm as well as refute, and isn't just a contrarian.

**source_label:** `Recovered plumbing contractor log (submitted live)`

**text:**

> Callout log, water subsystem. Both times we were called out to the basement
> riser, the pressure had been sliding for a few hours before anything
> actually let go — steady drop, not a sudden spike. Crew noted you could
> have caught it early if anyone had been watching the gauge trend rather
> than waiting for the alarm.

## Why this one is in the rehearsal set

It arrives from a completely different source (a contractor, not Cloudy) and
independently describes the same mechanism as **Entry 1**. A good agent should
recognise agreement across independent sources — and should say so without
overstating, since the supporting sample is only n=2.

## Expected agent behaviour

| Field | Expected |
| --- | --- |
| `verdict` | `supported` |
| `conflicts_with` | `null` (it agrees with `entry_1`, it doesn't contradict it) |
| `evidence` | Should cite the n=2 escalation validation and the sustained sub-−5 kPa/h decline preceding both confirmed water events |
| `operational_rule` | Likely restates or reinforces `pressure_slope_6h < -5 sustained 3h` |
| `note_to_dragons` | Plain-language: someone else noticed the same thing Cloudy did, and the data backs both of them |

Watch for the agent honestly carrying the small-sample caveat rather than
treating two independent anecdotes as proof.
