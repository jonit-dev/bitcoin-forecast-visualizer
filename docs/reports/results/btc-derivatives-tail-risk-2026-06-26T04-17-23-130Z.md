# BTC Derivatives Tail-Risk / Bounce-Risk Experiment

Generated: 2026-06-26T04:17:23.130Z

## Setup

- Validation: 2022-01-01 through 2024-12-31
- Holdout: 2025-01-01 through latest available target
- Interval model: median unchanged; sigma scaled by 1 + selectedScale * max(0, abs(fundingZ) + abs(premiumZ) - 1)
- Leakage policy: uses one-day-lagged feature table only; interval scale selected on 2022-2024 validation, then reported on 2025+ holdout.

## Event-condition holdout results

### 7d
- negativeFundingAfterDrawdown: samples=5, upRate=40.0%, baselineUpRate=46.7%, excessUpRate=-6.7%, medianReturn=-1.6%
- positiveCrowdingAfterRally: samples=6, upRate=33.3%, baselineUpRate=46.7%, excessUpRate=-13.3%, medianReturn=-2.3%

### 14d
- negativeFundingAfterDrawdown: samples=3, upRate=0.0%, baselineUpRate=43.2%, excessUpRate=-43.2%, medianReturn=-4.8%
- positiveCrowdingAfterRally: samples=3, upRate=33.3%, baselineUpRate=43.2%, excessUpRate=-9.9%, medianReturn=-0.4%

### 30d
- negativeFundingAfterDrawdown: samples=2, upRate=0.0%, baselineUpRate=41.2%, excessUpRate=-41.2%, medianReturn=-1.9%
- positiveCrowdingAfterRally: samples=0, upRate=n/a, baselineUpRate=41.2%, excessUpRate=n/a, medianReturn=n/a

### 60d
- negativeFundingAfterDrawdown: samples=1, upRate=100.0%, baselineUpRate=50.0%, excessUpRate=50.0%, medianReturn=12.2%
- positiveCrowdingAfterRally: samples=0, upRate=n/a, baselineUpRate=50.0%, excessUpRate=n/a, medianReturn=n/a

## Interval NLL holdout results

- 7d: selectedScale=0, samples=75, meanNllImprovement=0.0000, coverage90=92.0%, baselineCoverage90=92.0%, width90=0.2070, baselineWidth90=0.2070
- 14d: selectedScale=0.1, samples=37, meanNllImprovement=-0.0110, coverage90=91.9%, baselineCoverage90=91.9%, width90=0.2918, baselineWidth90=0.2871
- 30d: selectedScale=0, samples=17, meanNllImprovement=0.0000, coverage90=94.1%, baselineCoverage90=94.1%, width90=0.3983, baselineWidth90=0.3983
- 60d: selectedScale=0, samples=8, meanNllImprovement=0.0000, coverage90=100.0%, baselineCoverage90=100.0%, width90=0.5338, baselineWidth90=0.5338

