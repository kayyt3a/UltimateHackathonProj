# Reid Library Sensor Dataset

## Overview
--------
This dataset contains sensor readings from Reid Library's essential systems after the Giant Peacock attack. The library's automated systems are damaged but still operating.

The dataset contains measurements from the library's:
- Electrical power systems
- Ventilation systems
- Plumbing systems
- Environmental conditions
- Mechanical health monitoring
- Young dragon observations of machinery sounds

All timestamps are recorded hourly in July 2026.

In this folder is also maintenance logs from Cloudy (`cloudys_logs.md`) which give cryptic hints to the problems
in Reid Library!

## Column Descriptions
-------------------

**timestamp**
Unit:
- Date and time (YYYY-MM-DD HH:MM)

Description:
The time at which the sensor reading was recorded.


**power_kw**
Unit:
- kilowatts (kW)

Description:
The essential electrical power being consumed by the library systems.


**airflow_m3s**
Unit:
- cubic metres per second (m³/s)

Description:
The rate at which air is moved through the library ventilation system.


**water_pressure_kpa**
Unit:
- kilopascals (kPa)

Description:
The pressure of water supplied through the library plumbing system.


**water_flow_lps**
Unit:
- litres per second (L/s)

Description:
The volume of water moving through the plumbing system.


**temperature_c**
Unit:
- degrees Celsius (°C)

Description:
The internal temperature of the library shelter.


**vibration_level**
Unit:
- Relative vibration measurement (unitless)

Description:
A measure of mechanical vibration from library machinery. 
A higher number corresponds to stronger vibration.


**sound_event**
Unit:
- Categorical value

Possible values:
- normal
- hum
- rattle

Description:
Observations recorded by young dragons listening to machinery.


**system_status**
Unit:
- Categorical value

Possible values:
- stable
- warning
- critical
- failed
- recovering

Description:
The overall operational state of the library systems.
This is the ground truth label describing system condition.


**sensor_source**
Unit:
- Categorical value

Possible values:
- original
- barry_j_smart_sensor

Description:
Identifies the source of sensor readings. Barry J sensor readings
contain a small consistent calibration offset (find it and remove it!).

---

## The application

**Cloudy's Second Opinion** lives in **`ClaudeHackathon/`** — one Next.js app
containing all four slices:

| Slice | Where |
| --- | --- |
| Person A — data layer, analysis | `ClaudeHackathon/lib/data.ts`, `prepared_data.json`, `verdicts.md` |
| Person B — watchers, reconciliation agent | `ClaudeHackathon/lib/watchers.ts`, `app/api/reconcile` |
| Person C — severity, Voice agent, API | `ClaudeHackathon/lib/{aggregate,voice,diagnose}.ts`, `app/api/diagnose` |
| Person D — interface | `ClaudeHackathon/app/page.tsx`, `docs/ui-mockup.html` |

### Run it

```bash
cd ClaudeHackathon
npm install
npm run dev            # http://localhost:3000
```

Optional — Cloudy only speaks with a key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run prewarm        # fills the demo cache with real briefings
```

### Check it

```bash
npm test               # 309 tests, no API key needed
npm run verify:watchers    # severity/scope/escalation for each demo hour
```
