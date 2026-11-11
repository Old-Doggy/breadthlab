[简体中文](README.md) | [English](README.en.md)

<h1 align="center">BreadthLab</h1>

<p align="center">A 股市场宽度与结构面板</p>

<p align="center">
  <a href="https://github.com/Old-Doggy/breadthlab/actions/workflows/ci.yml"><img src="https://github.com/Old-Doggy/breadthlab/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white" alt="Node">
</p>

<p align="center">
  <img src="docs/screenshots/today.png" width="880" alt="今日盘面">
</p>

基于 Tushare 日频数据计算市场广度、等权/市值加权收益、集中度、行业参与和个股分化。包含 8 个页面的 Web 界面、Flask API 与单文件离线导出。

## 特性

- 广度、集中度、行业、个股、情绪、持仓六类视图
- 每日增量 + 9 条质量门禁；Tushare 故障时降级到 akshare
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
# A. 直接从 Tushare API 构建
python -m pipeline.bootstrap_api --start 20240101

# B. 使用本地 parquet 快照，结构见 docs/data_setup.md
python -m pipeline.bootstrap
```

```bash
python -m pipeline.build_marts
python -m backend.main      # http://127.0.0.1:8000
```

前端与单文件导出：

```bash
cd frontend && npm install && npm run build && cd ..
python -m pipeline.export_static
# 打开 frontend/dist/BreadthLab.html
```

## 文档

| 文档 | 内容 |
|---|---|
| [技术说明](docs/technical.md) | 架构、页面、质量门禁、并发、限制、Roadmap |
| [指标口径](docs/metric_contracts.md) | 每个指标的定义与分母 |
| [数据源](docs/data_sources.md) | 主源、备用源、降级规则 |
| [数据准备](docs/data_setup.md) | 快照目录结构与建库步骤 |
| [数据审计](docs/audit_findings.md) | 正确性验证与已知偏差 |

## License

MIT
