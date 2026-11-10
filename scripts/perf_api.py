"""API 性能实测：Flask test client（进程内），输出 p50/p95。"""
from __future__ import annotations

import json
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.main import app  # noqa: E402

ENDPOINTS = [
    "/api/meta",
    "/api/market/series",
    "/api/market/day/2026-11-10",
    "/api/sectors?date=2026-11-10",
    "/api/stocks?date=2026-11-10&limit=400",
    "/api/quality",
]


def main(repeat: int = 20) -> dict:
    app.config.update(TESTING=True)
    out = {}
    with app.test_client() as c:
        for ep in ENDPOINTS:
            # warmup
            c.get(ep)
            ts = []
            size = 0
            for _ in range(repeat):
                t0 = time.perf_counter()
                r = c.get(ep)
                ts.append((time.perf_counter() - t0) * 1000)
                size = max(size, len(r.data))
            out[ep] = {
                "p50_ms": round(statistics.median(ts), 1),
                "p95_ms": round(sorted(ts)[max(0, int(len(ts) * 0.95) - 1)], 1),
                "max_ms": round(max(ts), 1),
                "kb": round(size / 1024, 1),
            }
    payload = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "repeat": repeat, "endpoints": out}
    (ROOT / "data" / "meta" / "perf_api.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


if __name__ == "__main__":
    print(json.dumps(main(), ensure_ascii=False, indent=2))
