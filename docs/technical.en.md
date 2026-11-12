# Technical notes

> The older sections below describe the pre-audit release. The current pipeline has fourteen gates, per-day rollback, OS-owned publication locking and atomic HTML replacement. API updates call `pipeline.release`; failure preserves the previous HTML, and existing offline copies cannot receive future alerts. See [current technical notes](technical.md), [ADR-11](decisions/ADR-11-release-integrity.md) and the [repair report](release_fix_report.md). Frontend fixes, historical repairs on a database copy and actual browser validation are documented in the [completion report](release_completion_report.md).

## Architecture

```
Tushare API / akshare fallback / local parquet snapshot
        │  bootstrap / bootstrap_api / update_daily (idempotent, per-day, quality gates)
        ▼
data/lake.duckdb
        │  core_stock_day / core_index_day / core_limit_event / core_flow_day / core_margin_day
        ▼
feat_stock (adjustment, moving averages, highs, limit flags, streaks)
mart_market_day / mart_sector_day / mart_sector_month / mart_stock_latest
        ▼
Flask API ──► React + ECharts (dark/light, Chinese/English)
        └──► export_static.py ──► single-file HTML
```

Stack: DuckDB for local columnar aggregation, Flask for the API, React + TypeScript + Tailwind + ECharts on the frontend, built with Vite.

## Screens

| Screen | Contents |
|---|---|
| Today | Verdict, five KPIs, return × breadth, top contributors |
| Market structure | Return/breadth series, concentration, dispersion |
| Regime | Quadrant scatter, 30-day trail, regime duration and forward stats |
| Sectors | Bubbles, cumulative returns, rank migration, rotation strength |
| Stocks | Cap × return, distribution, table, candlesticks, PE percentile |
| Sentiment | Limit-ups/downs, streaks, highs/lows, seal quality, margin |
| Watchlist | Sector exposure, P&L contribution, positions, CSV |
| Method & data | Lineage, quality gates, update log, source reconciliation |
| `/labs` | Chart experiments (hexbin, treemap, gradient cloud, small multiples) |

## Update pipeline

`python -m pipeline.release` (steps 1–4 use update_daily):

1. Extend the trading calendar and find missing sessions
2. Fetch `daily / daily_basic / adj_factor / stk_limit / limit_list_d / moneyflow / margin` per day
3. Write the core layer
4. Run fourteen gates in the daily transaction; blocking failures roll back the day and prevent publication
5. `build_marts` rebuilds features and marts
6. `export_static` regenerates the single-file build

On Windows, `scripts/update.ps1` wraps the chain for the 17:35 weekday task; Sunday 02:00 runs a full rebuild.

Double-click `start.bat` to launch the web app: it validates the interpreter, reuses a running server, builds the frontend if needed and opens the browser; `stop.bat` stops it. Override the port with `BREADTHLAB_PORT` (default 8000).

## Quality gates

| # | Check | Level |
|---|---|---|
| 1 | Sample size ≥ 3,000; previous-day ratio 0.95–1.05 | block |
| 2 | Primary key unique | block |
| 3 | Price sanity (high/low/close, return range) | block |
| 4 | Return conflicts >0.1pp affect <1% of comparable rows | block |
| 5 | Positive finite factor/capitalization/adjusted-price coverage ≥99% | block |
| 6 | Breadth day-over-day sanity | warn |
| 7 | Sector coverage ≥97% | block |
| 8 | All adjustment factors valid | warn |
| 9 | Same-sample core EW change ≤8pp | warn |
| 10 | Finite nonnegative amount and volume | block |
| 11 | Positive limit-price coverage ≥99% of eligible sample | block |
| 12 | Four benchmark indices complete | warn |
| 13 | Index return consistency | block |
| 14 | Listing dates present | block |

Results go to `data/meta/quality/YYYYMMDD.json` and are shown on the Method & data screen.

## Concurrency and locking

DuckDB allows one writer at a time.

- API: a read-only connection per request, closed at request end
- Updater: `connect_wait` retries every 5 seconds, 300 seconds by default (`BREADTHLAB_LOCK_TIMEOUT`)
- While the updater holds the write lock, the API returns `503 + Retry-After: 10`
- The in-app "Fetch today" button calls `/api/update` with an `X-BreadthLab` header; a second concurrent run fails instead of reporting a false success

## Failure alerts

- A failed run writes `data/meta/alert.json` with time, stage, reason and log path
- `/api/meta` and the static payload carry `alert`
- The UI shows a red banner; after a failure the wrapper re-exports the single-file build so `file://` users see it too
- A successful full run clears the alert

## Data sources

Primary: Tushare Pro. Fallback: akshare (Eastmoney, free, no token), covering same-day `daily / daily_basic / stk_limit / adj_factor`. See [data_sources.md](data_sources.md).

Metric definitions: [metric_contracts.md](metric_contracts.md). Data setup: [data_setup.md](data_setup.md).

## Known limitations

- `limit_list_d` requires extra points; without it the broken-board rate shows `—` and streak height falls back to price limits
- Margin data is published T+1, so the latest session is empty
- Northbound flow changed definition on 2024-08-19; no cross-period series
- Sector membership is static, so historical attribution carries look-ahead bias
- `/labs` hexbin and treemap views are visual transforms; inputs are audited, individual cells are not

## Roadmap

- [x] Daily briefing PDF/PNG
- [x] Holdings P&L, sector rotation, candlesticks, PE percentile
- [x] Fourteen quality gates, update log, source reconciliation, failure alerts
- [x] Colorblind mode, URL state, PNG/CSV export
- [ ] Point-in-time Shenwan membership (requires `index_member_all`)
- [ ] Brinson attribution

## Layout

```
pipeline/   bootstrap / bootstrap_api / build_marts / update_daily / export_static / quality_gates / alerts
backend/    Flask API
frontend/   Vite + React + TypeScript + Tailwind + ECharts
config/     industry bridge, universe, data-source registry
scripts/    update / rebuild / dev / briefing / install_task (PowerShell)
tests/      metrics, API, locking, alerts, fallback source
docs/       definitions, data sources, audits, technical notes, screenshots
```
