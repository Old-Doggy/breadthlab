**简体中文** | [English](README.en.md)

# BreadthLab

A 股市场宽度与结构面板。基于 Tushare 日频数据计算市场广度、等权/市值加权收益、集中度、行业参与和个股分化，提供 Web 界面、HTTP API 与单文件离线导出。

[![CI](https://github.com/Old-Doggy/breadthlab/actions/workflows/ci.yml/badge.svg)](https://github.com/Old-Doggy/breadthlab/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Node](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

![今日盘面](docs/screenshots/today.png)

## 特性

- 8 个页面，覆盖广度、集中度、行业、个股、情绪、持仓
- 指标口径统一，图与数对应；定义见 [metric_contracts.md](docs/metric_contracts.md)
- 每日增量 + 9 条质量门禁；失败写告警并在页面顶部提示；Tushare 不可用时降级到 akshare
- 中英双语、深/浅主题、色盲配色、URL 状态、PNG/CSV 导出
- 支持导出单文件 HTML，离线打开

## 快速开始

要求：Python 3.12、Node 20+、Tushare Pro token（基础接口需 2000 积分）。

```bash
git clone https://github.com/Old-Doggy/breadthlab.git
cd breadthlab
conda create -n breadthlab python=3.12 -y
conda activate breadthlab
pip install -r requirements.txt
cp .env.example .env        # 填入 TUSHARE_TOKEN
```

构建数据（二选一）：

```bash
# A. 直接从 Tushare API 构建，无需本地快照
python -m pipeline.bootstrap_api --start 20240101

# B. 使用本地 parquet 快照，目录结构见 docs/data_setup.md
python -m pipeline.bootstrap
```

```bash
python -m pipeline.build_marts
```

运行：

```bash
python -m backend.main      # http://127.0.0.1:8000
```

单文件导出：

```bash
cd frontend && npm install && npm run build && cd ..
python -m pipeline.export_static
# 打开 frontend/dist/BreadthLab.html
```

每日更新：

```bash
python -m pipeline.update_daily
python -m pipeline.build_marts
python -m pipeline.export_static
```

Windows 可执行 `pwsh -File scripts/update.ps1`，并用 `scripts/install_task.ps1` 注册工作日 17:35 的计划任务。

## 页面

| 页面 | 内容 |
|---|---|
| 今日盘面 | 当日结论、5 个 KPI、收益×广度、贡献 Top5 |
| 市场结构 | 收益/广度序列、集中度、分化度 |
| 市场状态 | 四象限散点、30 日轨迹、状态统计 |
| 行业参与 | 气泡、累计收益、排名迁移、轮动强度 |
| 个股分化 | 市值×收益、收益分布、明细表、K 线 |
| 情绪极端 | 涨跌停、连板、新高新低、封板质量 |
| 自选组合 | 行业暴露、盈亏贡献、持仓明细 |
| 方法与数据 | 血缘、质量门禁、更新日志、源间对账 |

## 数据

- 主源 Tushare Pro；备用源 akshare，免费、无需 token
- 仓库不含行情数据，DuckDB 与 parquet 需本地构建
- 数据源与降级规则：[data_sources.md](docs/data_sources.md)
- 快照目录结构：[data_setup.md](docs/data_setup.md)
- 指标定义：[metric_contracts.md](docs/metric_contracts.md)

## 已知限制

- `limit_list_d` 需要额外积分，无权限时炸板率显示 `—`
- 两融数据 T+1，最新交易日为空
- 行业分类为静态映射，历史归属存在前视偏差
- 全部为描述性分析，不构成投资建议

## 文档

- 数据审计：[audit_findings.md](docs/audit_findings.md)
- 设计决策：[decisions.md](docs/decisions.md)
- 界面截图：[docs/screenshots/](docs/screenshots/)

## License

MIT
