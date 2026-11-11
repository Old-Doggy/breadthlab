[简体中文](README.md) | **English**

# BreadthLab

A market-structure terminal for China A-shares. It does not forecast the index. It shows who is actually participating, what is driving the move, and how split the market is underneath.

[![CI](https://github.com/Old-Doggy/breadthlab/actions/workflows/ci.yml/badge.svg)](https://github.com/Old-Doggy/breadthlab/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Node](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

![Today](docs/screenshots/en-today.png)

## What it answers

An index is a weighted average. A 1% gain can mean 70% of stocks rose, or that three heavyweights carried the tape. Watching the index alone cannot tell you:

- How many stocks actually took part?
- Was the move broad, or concentrated in a handful of names?
- Inside a sector, was it a real rally or one leader dragging the average up?
- Where do limit-ups, consecutive boards and seal quality stand?
- Is my book being lifted by the market, or by two stocks?

BreadthLab splits these into eight screens with one consistent set of definitions.

## Features

- **Eight screens**: Today, Market structure, Regime, Sectors, Stocks, Sentiment, Watchlist, Method & data
- **One definition per metric**: breadth, equal-weight and cap-weighted returns, HHI, Top10 contribution/share, CSD, IQR
- **Interaction**: quadrant scatter, sector bubbles, cumulative return paths, rank migration, candlesticks, drill-downs
- **Bilingual and themed**: Chinese/English, dark/light, colorblind-friendly palette (blue/orange)
- **Shareable**: URL state (`?range=1Y`, `?sector=电子`), chart PNG, table CSV
- **Single-file build**: JS, CSS, fonts and data inlined; opens offline with a double click
- **Daily update**: incremental fetch → 9 quality gates → core → marts → export; a failed run never publishes half-updated data
- **Fallback source**: if Tushare fails, `daily`, `daily_basic`, `stk_limit` and `adj_factor` fall back to akshare

## Screens

| Screen | Question | What is on it |
|---|---|---|
| **Today** | What kind of day was it? | Verdict, 5 KPIs, return × breadth, top contributors |
| **Market structure** | How do returns and breadth diverge over time? | Return/breadth series, concentration, dispersion |
| **Regime** | Where does today sit in return × breadth? | Quadrant scatter, 30-day trail, regime stats |
| **Sectors** | Which sector is broad, which is one stock? | Bubbles, cumulative paths, rank migration, rotation |
| **Stocks** | What does the sector average hide? | Cap × return scatter, distribution, table, detail card |
| **Sentiment** | Where do limit-ups and streaks stand? | Limit-ups/downs, streak ladder, highs/lows, margin |
| **Watchlist** | What is driving my book? | Sector exposure, P&L contribution, editable shares/cost |
| **Method & data** | Can I trust the numbers? | Lineage, quality gates, update log, source reconciliation |

| Sectors | Watchlist |
|---|---|
| ![Sectors](docs/screenshots/sectors.png) | ![Watchlist](docs/screenshots/watchlist.png) |

More screenshots, including English UI, colorblind mode and mobile, are in [`docs/screenshots/`](docs/screenshots/).

## Quick start

### Requirements

- Python **3.12** (conda recommended)
- Node **20+** (only if you work on the frontend)
- A **Tushare Pro token** — free signup; the basic interfaces (`daily`, etc.) need 2,000 points
- Windows, macOS or Linux. The scheduler and briefing scripts are currently Windows-oriented.

### Install

```bash
git clone https://github.com/Old-Doggy/breadthlab.git
cd breadthlab
conda create -n breadthlab python=3.12 -y
conda activate breadthlab
pip install -r requirements.txt
cp .env.example .env        # Windows: copy .env.example .env
```

Edit `.env`:

```ini
TUSHARE_TOKEN=your_token
# optional: local parquet snapshot (skip it to use the Tushare API)
# BREADTHLAB_SOURCE=./data/snapshot
```

### Build the data

**Option A — Tushare API (no snapshot needed)**

```bash
python -m pipeline.bootstrap_api --start 20240101
```

Seven API calls per trading day; expect roughly 1–2 seconds per day. `limit_list_d` requires extra points and is skipped automatically when unavailable.

**Option B — local parquet snapshot (faster, full history)**

Prepare a Tushare parquet export using the layout in [`docs/data_setup.md`](docs/data_setup.md), then:

```bash
python -m pipeline.bootstrap
```

Either way, finish with:

```bash
python -m pipeline.build_marts
```

### Run

Local API:

```bash
python -m backend.main          # http://127.0.0.1:8000
```

Single-file build:

```bash
cd frontend
npm install
npm run build
cd ..
python -m pipeline.export_static
# open frontend/dist/BreadthLab.html
```

Frontend dev server:

```bash
cd frontend
npm run dev                     # http://localhost:5173
```

### Daily update

```bash
python -m pipeline.update_daily
python -m pipeline.build_marts
python -m pipeline.export_static
```

On Windows, `pwsh -File scripts/update.ps1` runs the chain, and `scripts/install_task.ps1` registers a 17:35 weekday task. On macOS/Linux, put the same three commands in cron.

## Data and definitions

### Sources

- **Primary**: Tushare Pro (`daily`, `daily_basic`, `adj_factor`, `stk_limit`, `limit_list_d`, `moneyflow`, `margin`, `index_daily`)
- **Fallback**: akshare (Eastmoney), free and tokenless; covers `daily`, `daily_basic`, `stk_limit`, `adj_factor` for the current day
- **No data is shipped with this repo**: DuckDB, parquet files and tokens stay out of Git. Build them with the steps above.

### Definitions

| Metric | Definition |
|---|---|
| Breadth | N(up) / (N(up) + N(down)), flat days excluded |
| Equal-weight return | mean(pct_chg / 100) |
| Cap-weighted return | Σ wᵢrᵢ, weights from **prior-day** float cap |
| Concentration (HHI) | Σ wᵢ² × 10000 |
| Top10 contribution | Σ over top 10 weights of wᵢrᵢ × 100 (pp) |
| Top10 share | Σ\|wᵢrᵢ\| over top 10 / Σ\|wᵢrᵢ\|, bounded 0–1 |
| Dispersion (CSD) | Cross-sectional standard deviation of returns (pp) |
| Limit-up | `close ≥ up_limit × 0.999`, using real limits from `stk_limit` |
| New high | `adj_close ≥ 252-day high`, with at least 250 days of history |
| Sector | Tushare industry mapped to 31 Shenwan L1 groups, 99.9% coverage |

Sector mapping is the weakest link: `index_member_all` is empty locally and `bak_basic.industry` drifts. The project uses static labels plus a hand-maintained bridge; unmapped stocks are labelled "unclassified" in the UI.

## Layout

```
breadthlab/
├─ pipeline/       # bootstrap / bootstrap_api / build_marts / update_daily / export_static / quality_gates
├─ backend/        # Flask API
├─ frontend/       # Vite + React + TypeScript + Tailwind + ECharts
├─ config/         # industry bridge, universe, data-source registry
├─ scripts/        # update / dev / briefing / install_task (PowerShell)
├─ tests/          # metric golden values, API contract, lock and fallback tests
└─ docs/           # definitions, audits, data sources, screenshots
```

Stack: DuckDB for local columnar aggregation, Flask for a small synchronous API, React/ECharts for interaction, and a single-file export for offline viewing.

## Limitations

- `limit_list_d` needs extra points; without it the broken-board rate shows `—` and streak height is derived from price limits
- Margin data is published T+1, so the latest session shows `—`
- Northbound flow changed definition on 2024-08-19; no cross-period series is shown
- Sector membership is static, so historical attribution carries look-ahead bias
- Everything here is **descriptive**, not a forecast or investment advice

## Roadmap

- [x] Daily briefing PDF/PNG
- [x] Holdings P&L, sector rotation, candlesticks, PE percentile
- [x] Nine quality gates, update log, source reconciliation
- [x] Colorblind mode, URL state, PNG/CSV export
- [ ] Point-in-time Shenwan membership
- [ ] Simplified Brinson attribution
- [ ] Failure alerts (desktop / SMTP)

## License

MIT © 2026 BreadthLab contributors
