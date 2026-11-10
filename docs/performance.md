# 性能实测（2026-11-10，本机）

环境：Windows / 24 逻辑核 / 31 GB RAM / 单文件 dashboard（14.6 MB，内联数据与字体）。
测量方式：`scripts/perf_api.py`（Flask test client，进程内，20 次取分位）；
`frontend/scripts/e2e.mjs`（无头 Edge，file:// 加载）。

## 1. 前端加载（file://，无网络）

| 指标 | 实测 | 预算 |
|---|---:|---:|
| DOMContentLoaded | 397 ms | — |
| load | 401 ms | — |
| First Contentful Paint | 452 ms | < 2,500 ms |

页面切换（SPA 路由 + ECharts 重绘，含 400ms 等待）：

| 页面 | 耗时 |
|---|---:|
| Market | 474 ms |
| Sectors | 485 ms |
| Stocks | 515 ms |
| Watchlist | 437 ms |

> 页面切换略高于 500ms 预算的只有 Stocks（515ms），主要成本是 5,000+ 行表格首屏渲染。

## 2. API（进程内，DuckDB 直查）

| 端点 | p50 | p95 | 响应体 |
|---|---:|---:|---:|
| `/api/meta` | 0.6 ms | 1.4 ms | 0.2 KB |
| `/api/market/series` | 66 ms | 72 ms | 2.7 MB |
| `/api/market/day/{date}` | 67 ms | 114 ms | 16 KB |
| `/api/sectors?date=` | 3.5 ms | 4.2 ms | 11 KB |
| `/api/stocks?date=&limit=400` | 106 ms | 117 ms | 125 KB |
| `/api/quality` | 0.5 ms | 1.2 ms | 1.2 KB |

**结论**：全部端点 p95 < 150 ms，达标。`market/series` 返回全量 2,408 天（2.7 MB），
是最大的单次响应；如需进一步压缩，可在 API 侧按区间裁剪或返回列式二进制。

## 3. 复现

```powershell
python scripts/perf_api.py
cd frontend; node scripts/e2e.mjs
```

E2E 结果同时写入 `data/meta/e2e.json`（7 步全通过，0 console error）。
