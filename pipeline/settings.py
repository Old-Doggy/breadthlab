"""BreadthLab 全局配置。

所有路径、口径常量集中在这里，禁止在其它模块里重复定义。
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

# ---------------------------------------------------------------- 路径
SOURCE_ROOT = Path(os.getenv("BREADTHLAB_SOURCE", str(ROOT / "data" / "snapshot")))
DATA = ROOT / "data"
RAW = DATA / "raw"
MARTS = DATA / "marts"
META = DATA / "meta"
SNAPSHOTS = DATA / "snapshots"
LAKE = DATA / "lake.duckdb"
CACHE = DATA / "cache"

for _p in (DATA, RAW, MARTS, META, SNAPSHOTS, CACHE):
    _p.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------- 时间
# 主分析窗口。2016-12 作为 252 日新高等指标的预热区，不进入展示。
BOOTSTRAP_START = "2016-12-01"
DISPLAY_START = "2018-01-01"
SNAPSHOT_END = "2026-05-22"

# ---------------------------------------------------------------- 口径
# 股票池：沪深主板 + 创业板 + 科创板。北交所默认排除，可在 config 里打开。
UNIVERSE_EXCHANGES = ("SSE", "SZSE")
UNIVERSE_MARKETS = ("主板", "创业板", "科创板")
INCLUDE_BSE = False

# 收益口径
RETURN_CLIP = (0.01, 0.99)  # 仅用于图表截尾，统计保留原值

# 广度阈值
BREADTH_STRONG = 0.60
BREADTH_WEAK = 0.45

# 集中度
TOP_N_CONTRIB = 10

# 质量门禁
GATE_MIN_COVERAGE = 0.99
GATE_MIN_INDUSTRY_COVERAGE = 0.97

TUSHARE_TOKEN = os.getenv("TUSHARE_TOKEN", "").strip()

__all__ = [
    "ROOT", "SOURCE_ROOT", "DATA", "RAW", "MARTS", "META", "SNAPSHOTS", "LAKE", "CACHE",
    "BOOTSTRAP_START", "DISPLAY_START", "SNAPSHOT_END",
    "UNIVERSE_EXCHANGES", "UNIVERSE_MARKETS", "INCLUDE_BSE",
    "RETURN_CLIP", "BREADTH_STRONG", "BREADTH_WEAK", "TOP_N_CONTRIB",
    "GATE_MIN_COVERAGE", "GATE_MIN_INDUSTRY_COVERAGE", "TUSHARE_TOKEN",
]
