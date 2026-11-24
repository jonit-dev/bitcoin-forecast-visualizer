# BTC forecast-candle median race: prospective protocol (v1)

Status: **active specification, frozen on 2026-11-24**
Race version: `btc-candle-median-race-v1`
Ledger: `src/data/btc-candle-median-race-ledger.json`
Registered in: `docs/reports/experiments-backlog.md` (2026-11-24 entry)

## Purpose

Pick the price path that the semi-transparent BTC forecast candles center on, using only forecasts that were recorded before their outcome existed. The yellow model (power-law model line and its constants) is out of scope and stays unchanged. A race result can change only the candle median.

## Frozen rules

1. **Candidates.** Each origin records a median forecast from each of these three candidates:
   - `shipped`: `cycleAdjustedPowerLawForecast(target, originClose, origin)`. This is the median that the forecast candles center on today. It is the incumbent.
   - `naive`: `originClose`. The price stays where it is.
   - `pit_powerlaw`: `forecastCausalLogPowerLaw(fitCausalLogPowerLaw(rows <= origin, { withCycle: false, startDate: '2013-01-01' }), target, originClose, origin)`. A power law refit at each origin on past prices only.
2. **Horizons.** 14, 30, 90, 180 and 365 days. `target = origin + horizon` (calendar days).
3. **Origins.** Weekly, every 7 days from `2026-11-20`. Each origin uses only `btc-history.json` rows dated on or before the origin.
4. **Code freeze.** The ledger stores a SHA-256 of the candidate function sources. The append script refuses to run if the hash differs. A changed candidate needs a new race version and a new ledger.
5. **No outcome before recording.** An origin may be recorded late only while its shortest target (`origin + 14 days`) is after the latest available close, so no outcome is known. If an origin is missed past that point, the script records a `gap` row for it. Gaps are never filled later.
6. **Append-only.** Rows are never edited or deleted. Git history is the external witness.
7. **No interim scores.** Status output shows only row, gap and matured counts until a horizon is ready for review. This prevents outcome-driven changes.
8. **Review trigger.** A horizon is ready for review when it has at least 52 matured weekly origins.
9. **Metric.** MALE = mean of `|ln(forecast / actual close at target)|`. Lower is better.
10. **Decision rule at review.** A challenger replaces `shipped` as the candle median at a horizon only if all of these hold:
    - its MALE is at least 2% lower than `shipped`;
    - the 95% moving-block bootstrap interval of the MALE difference (block length = `ceil(horizon / 7)` origins, 5,000 resamples, seed `20261124`) is entirely below 0;
    - the change passes the relevant `npm run backtest` gate, as `AGENTS.md` requires.

    If no challenger passes, `shipped` stays.
11. **Earliest reviews.** With no gaps, the 52nd weekly origin is `2027-11-12`. The 14-day horizon is reviewable on `2027-11-26`, 30-day on `2027-12-12`, 90-day on `2028-02-10`, 180-day on `2028-05-10` and 365-day on `2028-11-11`.
