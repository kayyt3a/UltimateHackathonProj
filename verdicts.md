
| Note | Verdict | Evidence |
|---|---|---|
| 1 — pipes complain first | **Supported** | pressure_slope_6h separates escalating from resolving episodes by ~hour 4 of warning (Figure 6) |
| 2 — the library has a rhythm | **Redundant** | sound_event maps 1:1 onto system_status, zero off-diagonal (Figure 4) |
| 3 — fans running in circles | **Supported, strongest** | airflow = 0.1250·power -1.5000, r² = 0.999999 (Figure 3) |
| 4 — cold arrives later | **Refuted** | temperature and airflow drop in the same hour, not lagged |
| 5 — missing pieces | **Unsupported** | 6 gaps scatter across the month, no clustering near incidents (Figure 7) |

Bonus finding: onset is not forecastable. t+6h classifier reaches 88.5% accuracy
but catches 0 of 24 true onset-precursor rows — the accuracy is pure persistence (Figure 5).

Bonus finding: GMM catches both held-out fault types (Figure 8) that Isolation Forest misses,
because the fault lives in the joint distribution, not any single marginal.
