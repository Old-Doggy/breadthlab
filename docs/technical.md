# 技术说明

## 架构

```
Tushare API / akshare 备用源 / 本地 parquet 快照
        │  bootstrap / bootstrap_api / update_daily（幂等、按日批量、质量门禁）
        ▼
data/lake.duckdb
        │  core_stock_day / core_index_day / core_limit_event / core_flow_day / core_margin_day
        ▼
feat_stock（复权、均线、新高、涨跌停、连板）
mart_market_day / mart_sector_day / mart_sector_month / mart_stock_latest
        ▼
Flask API ──► React + ECharts（深/浅主题、中/英）
        └──► export_static.py ──► 单文件 HTML
```

技术栈：DuckDB（本地列存）、Flask（同步 API）、React + TypeScript + Tailwind + ECharts、Vite。

## 页面

| 页面 | 内容 |
|---|---|
| 今日盘面 | 当日结论、5 个 KPI、收益×广度、贡献 Top5 |
| 市场结构 | 收益/广度序列、集中度、分化度 |
| 市场状态 | 四象限散点、30 日轨迹、状态持续与后续统计 |
| 行业参与 | 气泡、累计收益、排名迁移、轮动强度 |
| 个股分化 | 市值×收益、收益分布、明细表、K 线、PE 分位 |
| 情绪极端 | 涨跌停、连板、新高新低、封板质量、两融 |
| 自选组合 | 行业暴露、盈亏贡献、持仓明细、CSV |
| 方法与数据 | 血缘、质量门禁、更新日志、源间对账 |
| `/labs` | 图表实验页（hexbin、treemap、渐变云图等） |

## 更新链路

`python -m pipeline.update_daily`：

1. 扩展交易日历，找出缺口交易日
2. 逐日抓取 `daily / daily_basic / adj_factor / stk_limit / limit_list_d / moneyflow / margin`
3. 写入 core 层
4. 运行 9 条质量门禁；阻断级失败则退出码 2，不发布
5. `build_marts` 重算 feat 与 mart
6. `export_static` 重新生成单文件

Windows 下 `scripts/update.ps1` 封装了以上步骤，工作日 17:35 由计划任务触发；周日 02:00 全量重建。

## 质量门禁

| # | 检查 | 级别 |
|---|---|---|
| 1 | 单日样本数 ≥ 3,000 | 阻断 |
| 2 | 主键唯一 | 阻断 |
| 3 | 价格合法性（high/low/close 关系、涨跌幅范围） | 阻断 |
| 4 | 复权因子覆盖 ≥ 95% | 阻断 |
| 5 | 行业覆盖 ≥ 97% | 阻断 |
| 6 | 广度日变化合理性 | 警告 |
| 7 | 成交额非负且量级合理 | 阻断 |
| 8 | 指数数据完整 | 警告 |
| 9 | 与昨日 mart 连续性 | 警告 |

门禁结果写入 `data/meta/quality/YYYYMMDD.json`，About 页展示最近一次。

## 并发与锁

DuckDB 同一时刻只允许一个写连接。

- API：每个请求开只读连接，请求结束立即释放
- 更新器：`connect_wait` 每 5 秒重试，默认等 300 秒（`BREADTHLAB_LOCK_TIMEOUT` 可调）
- 更新期间 API 返回 `503 + Retry-After: 10`
- 页面上的“拉取今日数据”按钮通过 `/api/update` 触发同一链路，要求 `X-BreadthLab` 请求头；已有任务运行时直接返回失败，不会假装成功

## 失败告警

- 失败写 `data/meta/alert.json`：时间、阶段、原因、日志路径
- `/api/meta` 与静态 payload 都会带上 `alert`
- 页面顶部显示红色横幅，`file://` 单文件也会在失败后重新导出并带上告警
- 整条链路成功后自动清除

## 数据源

主源 Tushare Pro；备用源 akshare（东方财富，免费无 token），覆盖 `daily / daily_basic / stk_limit / adj_factor` 的当日降级。详见 [data_sources.md](data_sources.md)。

指标定义见 [metric_contracts.md](metric_contracts.md)，数据准备见 [data_setup.md](data_setup.md)。

## 已知限制

- `limit_list_d` 需要额外积分；无权限时炸板率显示 `—`，连板高度改用价格判定
- 两融数据 T+1，最新交易日为空
- 北向资金 2024-08-19 后口径断裂，不做跨期序列
- 行业分类为静态映射，历史归属存在前视偏差
- `/labs` 的 hexbin、treemap 等属于可视化变换，只保证输入数据正确与渲染正常

## Roadmap

- [x] 每日简报 PDF/PNG
- [x] 自选持仓、行业轮动、K 线、PE 分位
- [x] 9 条质量门禁、更新日志、源间对账、失败告警
- [x] 色盲模式、URL 状态、PNG/CSV 导出
- [ ] 申万 PIT 行业成员（需要 `index_member_all` 权限）
- [ ] Brinson 归因

## 目录

```
pipeline/   bootstrap / bootstrap_api / build_marts / update_daily / export_static / quality_gates / alerts
backend/    Flask API
frontend/   Vite + React + TypeScript + Tailwind + ECharts
config/     industry_bridge.csv、universe.yaml、data_source_registry.yaml
scripts/    update.ps1 / rebuild.ps1 / dev.ps1 / briefing.ps1 / install_task.ps1
tests/      指标、API、锁、告警、备用源
docs/       口径、数据源、审计、技术说明、截图
```
