# 发布说明（GitHub）

> 以下完成勾选属于旧版本记录。当前候选版本的修复与验收以 [最终交付报告](release_completion_report.md) 为准，不能用下方历史勾选放行。

## 1. 仓库名

**推荐：`breadthlab`**

- 10 字符、全小写、无连字符
- `breadth` = 市场宽度（产品核心指标），`lab` = 可探索/可扩展
- 与 Python 包名、DuckDB 文件名一致，零改名成本
- 组合词，重名概率低

**备选**：`breadthlab-cn`（强调 A 股）、`a-share-breadth`（最直白）、`breadth-terminal`（强调终端形态）

## 2. 仓库描述

> A-share market breadth & structure terminal — DuckDB + Flask + React/ECharts. 8 pages, auto daily update, single-file offline build.

## 3. Topics

`a-share` `tushare` `market-breadth` `duckdb` `echarts` `dashboard` `quant` `data-visualization`

## 4. 推送前检查（已全部通过）

- [x] `pytest` 15 passed
- [x] `ruff` E9/F63/F7/F82 通过
- [x] E2E 7 步通过（`frontend/scripts/e2e.mjs`）
- [x] P2 验证：PNG/CSV 按钮、色盲模式、URL 状态（`frontend/scripts/verify_p2.mjs`）
- [x] `.env` 未入库；`data/`、`frontend/dist/` 已忽略
- [x] `LICENSE`（MIT）、`.gitattributes`
- [x] 工作区干净

## 5. 推送命令

```powershell
cd breadthlab
git remote add origin git@github.com:<用户名>/breadthlab.git
git branch -M main
git push -u origin main
git tag -a v0.2.0 -m "v0.2.0: holdings, rotation, k-line, seal quality, colorblind, export"
git push origin v0.2.0
```

若用 HTTPS：

```powershell
git remote add origin https://github.com/<用户名>/breadthlab.git
```

## 6. 推送后

1. GitHub → Settings → Actions：确认 CI 跑通（ruff + pytest + web build）
2. 仓库 About 填入描述与 topics
3. Release 用 `v0.2.0`，正文可直接引用 `README.md` 的 v0.2 新增段
4. 若公开数据截图，确认 `docs/screenshots/` 不含个人信息（当前仅行情与自选示例）

## 7. 不随仓库分发的内容

- `data/`（DuckDB、parquet、快照、简报）——体积大且含行情数据
- `.env`（Tushare token）
- `frontend/dist/`（构建产物，可由 `npm run build` + `pipeline.export_static` 重建）

新用户按 README「快速开始」：建 conda 环境 → 填 token → `python -m pipeline.bootstrap` → `python -m backend.main` 或 `python -m pipeline.export_static`。
