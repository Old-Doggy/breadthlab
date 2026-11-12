# 技术说明

2026-11-12：前后端修复、数据库副本历史修复与实际验收结果见 [最终交付报告](release_completion_report.md)。14门禁通过不代表事件权限齐全、历史行业为时点数据或独立源已确认。

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

`python -m pipeline.release`（前四步由 update_daily 执行，后两步由发布入口衔接）：

1. 扩展交易日历，找出缺口交易日
2. 逐日抓取 `daily / daily_basic / adj_factor / stk_limit / limit_list_d / moneyflow / margin`
3. 写入 core 层
4. 同一日事务内运行 14 条质量门禁；失败回滚，可重试该日，不发布
5. `build_marts` 重算 feat 与 mart
6. `export_static` 重新生成单文件

`pipeline.release` 是 API/Windows 共用完整入口；`--rebuild` 仅验质、重建和导出。逐数据集记录完成状态，重查近20个交易日及旧缺口；两融/资金流/事件另行回补。Windows 工作日17:35触发，周日02:00重建；任务账户应使用上海时区。

## 质量门禁

| # | 检查 | 级别 |
|---|---|---|
| 1 | 单日行数 ≥3,000，且相对前日0.95–1.05 | 阻断 |
| 2 | 主键唯一 | 阻断 |
| 3 | 有限正OHLC与价格关系；IPO按真实上市日期豁免极端收益 | 阻断 |
| 4 | 可比较样本收益冲突比例 <1%（容差0.1pp） | 阻断 |
| 5 | 正且有限复权因子、市值、复权价覆盖 ≥99% | 阻断 |
| 6 | 广度日变化合理性 | 警告 |
| 7 | 行业覆盖 ≥97% | 阻断 |
| 8 | 所有复权因子有效 | 警告 |
| 9 | 同口径core样本日EW变化≤8pp，不依赖旧mart | 警告 |
| 10 | 成交额、成交量有限且非负 | 阻断 |
| 11 | 成熟有效样本正限价覆盖 ≥99% | 阻断 |
| 12 | 四个基准指数完整 | 警告 |
| 13 | 指数pct_chg与close/pre_close一致 | 阻断 |
| 14 | 沪深主池上市日期齐全 | 阻断 |

门禁结果写入 `data/meta/quality/YYYYMMDD.json`，About 页展示最近一次。

## 并发与锁

DuckDB 同一时刻只允许一个写连接。

- API：每个请求开只读连接，请求结束立即释放
- 更新器：`connect_wait` 每 5 秒重试，默认等 300 秒（`BREADTHLAB_LOCK_TIMEOUT` 可调）
- 更新期间 API 返回 `503 + Retry-After: 10`
- API按钮通过固定参数调用完整发布链，要求自定义头及本机Host/Origin；同一进程已有任务返回202及原任务状态。跨进程使用操作系统文件锁，冲突非零退出，无“跳过即成功”。

## 失败告警

- 失败写 `data/meta/alert.json`：时间、阶段、原因、日志路径
- `/api/meta` 与静态 payload 都会带上 `alert`
- API透传受控告警。失败保留上一份完整HTML，不将部分新数据重新烘焙；已分发或打开的离线HTML不会收到未来告警。
- HTML成功原子替换后才清除磁盘告警；候选HTML排除旧告警。

## 数据源

主源 Tushare Pro；备用源 akshare（东方财富，免费无 token），覆盖 `daily / daily_basic / stk_limit / adj_factor` 的当日降级。详见 [data_sources.md](data_sources.md)。

指标定义见 [metric_contracts.md](metric_contracts.md)，数据准备见 [data_setup.md](data_setup.md)。

## 已知限制

- `limit_list_d` 需要额外积分；无权限时炸板率显示 `—`，连板高度改用价格判定
- 两融T+1，最新交易日可以为空，后续独立回补；真实权限与上游发布仍需验收
- 北向资金 2024-08-19 后口径断裂，不做跨期序列
- 行业分类为静态映射，历史归属存在前视偏差
- `/labs` 的 hexbin、treemap 等属于可视化变换，只保证输入数据正确与渲染正常

## Roadmap

- [x] 每日简报 PDF/PNG
- [x] 自选持仓、行业轮动、K 线、PE 分位
- [x] 14 条质量门禁、更新日志、源间对账、失败告警（离线旧包无法接收新告警）
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
