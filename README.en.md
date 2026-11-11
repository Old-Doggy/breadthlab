[简体中文](README.md) | **English**

<h1 align="center">BreadthLab</h1>

<p align="center">Market breadth and structure dashboard for China A-shares</p>

<p align="center">
  <a href="https://github.com/Old-Doggy/breadthlab/actions/workflows/ci.yml"><img src="https://github.com/Old-Doggy/breadthlab/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white" alt="Node">
</p>

<p align="center">
  <img src="docs/screenshots/en-today.png" width="880" alt="Today">
</p>

Computes breadth, equal- and cap-weighted returns, concentration, sector participation and dispersion from Tushare daily data. Includes an eight-screen web UI, a Flask API and a single-file offline export.

## Features

- Six view families: breadth, concentration, sectors, stocks, sentiment and holdings
- Daily incremental load with nine quality gates; falls back to akshare when Tushare fails
- Chinese/English UI, dark/light themes, colorblind palette, URL state, PNG/CSV export
- Single-file HTML build for offline use

## Quick start

Requirements: Python 3.12, Node 20+, a Tushare Pro token (basic interfaces need 2,000 points).

```bash
git clone https://github.com/Old-Doggy/breadthlab.git
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
cd frontend && npm install && npm run build && cd ..
python -m pipeline.export_static
# open frontend/dist/BreadthLab.html
```

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
