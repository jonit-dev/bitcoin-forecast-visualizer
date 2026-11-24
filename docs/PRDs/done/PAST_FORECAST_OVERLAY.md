# PRD: Past Forecast Overlay

Complexity: 5 -> MEDIUM mode

Score: +2 for a new point-in-time hindcast builder, +2 for a new chart primitive and toggle, +1 for look-ahead guards.

Status: Done (Phases 1-3, 2026-11-24). Phase 4 stays open until the prospective ledger has matured rows.

Owner: Forecasting / Engineering

## 1. Context

**Problem:** The chart shows only the forecast from today. The user cannot see what the model forecast at earlier dates, so the user cannot judge the forecast against the real price.

**Request:** Show past forecasts as an overlay on the price history. Put the overlay behind a toggle. The toggle is off by default.

**Files analyzed:**

- `src/App.tsx` (overlay toggles, `overlayControls`, `ForecastChart` props)
- `src/components/workspace/ChartSettings.tsx` (toggle dialog, group `Forecast`)
- `src/components/Chart.tsx`, `src/components/chart/primitives.ts`, `src/components/chart/types.ts`
- `src/lib/data.ts` (`processRealData`, `computeProbabilityForecast`)
- `src/lib/cycle.ts` (`cycleAdjustedPowerLawForecast`, `KNOWN_PIVOTS`, `cyclePivotTargetPrice`)
- `src/lib/powerLawFit.ts` (`fitPowerLawCoefficients`, `forecastWithPowerLawCoefficients`)
- `src/lib/forecastInterval.ts` (`computePowerLawInterval`)
- `src/lib/pointInTimeForecast.ts` and `docs/reports/results/point-in-time-core-2026-11-21T21-18-19-068Z.json`
- `src/data/prospective-forecast-ledger.json` (0 rows on 2026-11-24)

**Current behavior:**

- The yellow BTC median path is `cycleAdjustedPowerLawForecast(date, lastClose, lastDate)`. It is cheap: a closed-form curve per day.
- That curve uses full-sample power-law constants (`POWER_LAW_CONFIG`) and full-sample cycle pivots (`KNOWN_PIVOTS`, for example the 2017-12-17 and 2021-11-10 tops).
- The prospective ledger has no rows yet. It cannot supply past forecasts today.
- The point-in-time report has honest monthly origins (2017 to 2026) but only for 14/30/60/90 days, only endpoints, and without cycle pivots. It does not match the yellow line.

## 2. Key decision: point-in-time hindcast, not a naive replay

> **Superseded on 2026-11-24 by owner decision (option A): replay today's model.** The point-in-time refit was built and rejected. `fitPowerLawCoefficients` does not reproduce the production constants: it gives exponent 5.59, but `POWER_LAW_CONFIG.base` has 3.67. The production constants are hand-set and have been in the code since the initial commit. The refit put the 2026-05-24 trend at $180k, so its projection went up ($105.8k at 180 days) while the yellow curve went down ($57.5k; real price $59.1k). The shipped overlay replays `cycleAdjustedPowerLawForecast` from each origin, with the band from rows up to that origin. The UI labels it "model replay" and says the constants were set with hindsight. The original text is kept below for the record.

A naive replay (call today's code on truncated price data) leaks the future. The model would "know" the 2017 and 2021 tops from `KNOWN_PIVOTS` and the full-sample power-law fit. Past forecasts would look much better than any real forecast was. That misleads the user.

**Decision:** Build each past forecast point-in-time:

1. Price data: rows with `date <= origin` only.
2. Power law: refit with `fitPowerLawCoefficients(rows <= origin)`. Use `forecastWithPowerLawCoefficients` for the raw path.
3. Cycle pivots: a pivot counts as known only if `pivot.date <= origin - PIVOT_CONFIRMATION_DAYS` (90 days). Generate later pivots from the last known pivot with the same cadence rule as `generateCyclePivots`.
4. Pivot target prices: derive peak and floor from the refit base with the production peak and floor ratios. Do not use the full-sample peak and floor constants.
5. Interval: `computePowerLawInterval` on the truncated rows. The horizon multiplier tables stay full-sample. Disclose this residual leak in the tooltip.

**Label:** "Past forecasts (point-in-time hindcast)". Do not call them "past forecasts we published". Real published forecasts come from the prospective ledger later (Phase 4).

## 3. UX

- New toggle in Chart settings, group `Forecast`: **Past forecasts**. Default off. BTC only in Phase 1. Hide the toggle for S&P 500 and gold.
- Origins: one origin every `horizon` days, counted back from the last candle, so fans do not overlap. Cap at 24 origins. Skip origins with fewer than 365 rows of history (interval minimum).
- Each past forecast draws candle projections, built the same way as the live projection (`projectCandles`), from the replayed median and the rows up to its origin. Owner feedback on 2026-11-24 rejected the first version, which used yellow dashed median and dotted band lines.
- The live forecast stays on top and unchanged.
- Crosshair legend: when the cursor is on a past fan, show "Forecast from <origin>: median $X, band $L to $U".
- Recompute only when the toggle is on, and when horizon, confidence or data change. Memoize in `App.tsx`.

## 4. Phases

### Phase 1: Point-in-time builder (`src/lib/pastForecasts.ts`)

- [x] ~~Add optional `asOf` to the pivot lookup~~ Not needed. Production uses `CYCLE_EXPERIMENT_CONFIG.selectedStrategyId = 'no-future-pivots'`, so `cycleAdjustedPowerLawForecast` returns the raw power-law path and reads no pivots. The hindcast mirrors that and uses no pivots, so §2 steps 3 and 4 do not apply. A test asserts the strategy id: if production starts to use pivots, the test fails and point-in-time pivots must be added. `cycle.ts` is unchanged.
- [x] `buildPastForecasts(ohlcv, horizon, confidenceZ)` returns `{ originDate, points: { date, median, upper, lower }[] }[]` (`src/lib/pastForecasts.ts`). The band is `median · exp(±z · blendedPowerLawHeatmapVol(rows <= origin) · effectiveSigmaScaleForHorizon(h))`, which is the same sigma as `computePowerLawInterval` on the truncated rows (a test proves this).
- [x] Red-green tests in `src/lib/__tests__/pastForecasts.test.ts` (7 tests; a full-data look-ahead mutation makes 4 of them fail):
  - look-ahead guard: change any price after an origin; that origin's forecast must not change;
  - pivot guard: an origin on 2017-10-01 must not use the 2017-12-17 top;
  - spacing and cap: origins are `horizon` days apart and at most 24;
  - production guard: `processRealData` output is unchanged.

### Phase 2: Chart overlay

- [x] One extra `CandlestickSeries` in `Chart.tsx` holds every past projection. The projections never overlap, so one series is enough and no primitive is needed. The first version used a `PastForecastPrimitive` with yellow lines, which was removed.
- [x] Props `showPastForecasts` and `pastForecasts` in `ForecastChartProps`.
- [x] Toggle in `overlayControls` (`App.tsx`), `useState(false)`.
- [x] Component test: toggle off renders no fans. Toggle on renders N fans. The crosshair readout and the playback hide are also tested.

### Phase 3: Visual check

- [x] Screenshot on the 1Y, ALL and 6M ranges, toggle off and on. Saved to `~/Downloads/past-forecast-overlay/` (6 files).
- [x] Check that the live forecast, heatmap and legend still render as before. The toggle is hidden on S&P 500 and gold.

### Phase 4 (later, optional): Real published forecasts

- [ ] When the prospective ledger has matured rows, draw them as solid markers, separate from the hindcast fans. Out of scope until the ledger has data.

## 5. Out of scope

- Any change to the live forecast, interval or calibration.
- S&P 500 and gold hindcasts. Add later with the same builder pattern if Phase 1 works.
- A hit-rate scorecard. If added later, register it in `docs/reports/experiments-backlog.md` as report-only, per `AGENTS.md`.

## 6. Forecast safety

- This feature changes display only. It does not change the forecast. `npm run backtest` is not required.
- Run the related tests: `pastForecasts.test.ts`, `Chart.test.ts`, `Chart.component.test.tsx`, and the existing yellow-line and cycle tests.

## 7. Risks

- ⚠️ Residual leak: the interval multiplier tables and the cycle cadence (`ATL_TO_ATH_DAYS`, `ATH_TO_ATL_DAYS`) are full-sample. The tooltip must say "hindcast".
- ⚠️ Early origins (before about 2016) have short fit windows. The fit minimum skips them.
- ⚠️ Performance: 24 origins × refit (4-parameter OLS) × horizon days. Expected under 50 ms for a 365-day horizon. Measure in Phase 1. Cap the origins for 5Y and 10Y horizons (about 2 to 3 fans fit in history).

## 8. Results (2026-11-24)

- ✅ Shipped as candle projections from today's model, replayed from up to 24 origins one horizon apart. The band comes from rows up to each origin. A test proves that each replay matches `processRealData` on the truncated rows (median, upper and lower).
- ✅ Related tests: 12 files, 61 tests pass. `tsc --noEmit` is clean. Red checks done for look-ahead, replay and toggle gate.
- ✅ Speed: 3 to 13 ms per build. The rejected refit took 52 to 150 ms.
- ✅ Hidden during playback and on S&P 500 and gold. With the toggle off, the chart is unchanged.
- Owner decision on 2026-11-24: the toggle is **on by default** (overrides §3 "Default off").
- ⚠️ Hindsight: the model constants were set with data after most origins. The toggle description says so, and the readout says "model replay".
- Screenshots: `~/Downloads/past-forecast-overlay/` (4 files).
