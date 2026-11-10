# 数据体检（2026-11-10）

数据根目录：`./data/snapshot`（按 `ts_code` 重排的 parquet，2014-01-02 → 2026-05-22）。
本文件记录建库时实际跑出来的数字，供复现与答辩引用。

## 1. 规模

| 表 | 行数 | 说明 |
|---|---:|---|
| `core_stock_day` | 9,587,377 | 2016-12 起，daily + adj_factor + daily_basic + stk_limit |
| `core_limit_event` | 155,289 | 涨停/跌停/炸板事件（limit_list_d） |
| `core_flow_day` | 9,811,847 | 资金流（moneyflow） |
| `core_sw_day` | 1,189,937 | 申万行业指数 |
| `feat_stock` | 9,283,968 | 剔除北交所与新上市前 5 日后的特征表 |
| `mart_market_day` | 2,293 | 2016-12-08 → 2026-05-22 |
| `mart_sector_day` | 70,852 | 31 个申万一级 × 2,293 日 |
| `mart_stock_latest` | 5,191 | 最新交易日快照 |

DuckDB 文件约 **856 MB**，全量 bootstrap 约 **60 秒**（24 核 / 31 GB）。

## 2. 质量结论

- `pct_chg` 缺失率 ≈ 0（抽样 4 只股票均为 0）。
- `close / pre_close - 1` 与官方 `pct_chg` 差异 >0.1pp 的比例极低，主口径采用官方 `pct_chg`。
- `circ_mv`/`adj_factor` 在 2018 年后覆盖率 >99.5%；停牌日无行情行，按“当日有效样本”计算，不补造。
- 最新交易日（2026-05-22）：有效样本 **5,188**，上涨 3,735 / 下跌 1,339，广度 **73.6%**，等权收益 **+1.74%**。
- 行业映射覆盖：5,191 只中 **6 只未分类（99.88%）**。
- `index_daily` 本地只到 2026-05-08，已用 akshare 补齐 500 行（4 个指数 × 125 个交易日），`hs300_ret` 不再为空。

## 3. 已知坑与处理

| 坑 | 证据 | 处理 |
|---|---|---|
| `index_member_all` 只有 1 行 | 目录仅 1 文件 | 弃用，改静态桥接表 |
| `bak_basic.industry` 漂移 | 抽样 200 只中 119 只标签变化 | 不用作主映射 |
| 北向口径断裂 | 2024-08-19 后 410 个交易日 `north_money` 全为正、量级 30–43 亿（成交额） | 不做跨期序列 |
| `stk_factor_pro` 23 GB | 单文件 | 不读 |
| 快照停更 | 2026-05-22 | 增量脚本待 token 补齐 |
| 新股首日极端收益 | 注册制首日无涨跌幅 | 上市前 5 日剔除出市场聚合 |

## 4. 复现

```powershell
python -m pipeline.bootstrap
python -m pipeline.build_marts
python -m pipeline.export_static
```
