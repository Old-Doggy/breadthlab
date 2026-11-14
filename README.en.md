[简体中文](README.md) | **English**

<h1 align="center">BreadthLab</h1>

<p align="center">Market breadth and structure dashboard for China A-shares</p>

<p align="center">
  <a href="https://github.com/Old-Doggy/a-share-breadth-dashboard/actions/workflows/ci.yml"><img src="https://github.com/Old-Doggy/a-share-breadth-dashboard/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/node-22.18%2B-339933?logo=node.js&logoColor=white" alt="Node">
</p>

<p align="center">
  <img src="docs/screenshots/en-today.png" width="880" alt="Today">
</p>

Computes breadth, equal- and cap-weighted returns, concentration, sector participation and dispersion from Tushare daily data. Includes eight main screens plus briefing and chart-lab routes, a Flask API and a single-file offline export.

## Features

- Six view families: breadth, concentration, sectors, stocks, sentiment and holdings
- Daily updates with fourteen quality gates; current-day post-close akshare fallback
- Chinese/English UI, dark/light themes, colorblind palette, URL state, PNG/CSV export
- Single-file HTML build for offline use

## Quick start

Requirements: Python 3.12, Node 22.18+, a Tushare Pro token (additional endpoints require their own permissions).

### One-click start (Windows)

Double-click `start.bat`: it picks a Python with duckdb/tushare, starts the server and opens http://127.0.0.1:8000. If it is already running, it just opens the page. Double-click `stop.bat` to stop it. A missing frontend build is created with `npm install && npm run build`.

```bash
git clone https://github.com/Old-Doggy/a-share-breadth-dashboard.git
cd breadthlab
conda create -n breadthlab python=3.12 -y
conda activate breadthlab
pip install -r requirements.txt
cp .env.example .env        # set TUSHARE_TOKEN
```

Build the data (pick one):

```bash
# A. Build from the Tushare API
python -m pipeline.bootstrap_api --start 20240101

# B. Use a local parquet snapshot; layout in docs/data_setup.md
python -m pipeline.bootstrap
```

```bash
python -m pipeline.build_marts
python -m backend.main      # http://127.0.0.1:8000
```

Frontend and single-file build:

```bash
cd frontend && npm ci && npm run check && cd ..
python -m pipeline.refresh_status
python -m pipeline.export_static
# open frontend/dist/BreadthLab.html
```

Use `python -m pipeline.release` for daily publication, or add `--rebuild` to rebuild only.
Failed publication preserves the previous HTML. Existing offline copies cannot receive later alerts.
Frontend and backend fixes and historical repairs were validated against an isolated database copy. Original data and release artifacts were preserved. See the [completion report](docs/release_completion_report.md) for evidence and remaining source limitations.

## Docs

| Doc | Contents |
|---|---|
| [Technical notes](docs/technical.en.md) | Architecture, screens, quality gates, concurrency, limits, roadmap |
| [Metric definitions](docs/metric_contracts.md) | Definition and denominator of each metric |
| [Data sources](docs/data_sources.md) | Primary, fallback and degradation rules |
| [Data setup](docs/data_setup.md) | Snapshot layout and bootstrap steps |
| [Data audit](docs/audit_findings.md) | Correctness checks and known biases |

## License

MIT
