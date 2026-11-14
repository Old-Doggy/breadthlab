# 数据准备

仓库不包含任何行情数据。你可以用两种方式构建本地 `data/lake.duckdb`。

## 方式 A：Tushare API（推荐给第一次跑的人）

```bash
python -m pipeline.bootstrap_api --start 20240101
python -m pipeline.build_marts
```

- 默认从2024-01-01开始。每天7类数据中涨跌停事件分U/D/Z三次，另有4个指数请求，约13次请求/交易日，另加元数据和日历请求；耗时和配额依权限、网络而定。
- 核心数据缺失或阻断门禁失败则回滚当日并中断；重跑同一区间会跳过较早已完整日期，最近20个交易日重查。
- `limit_list_d` 需要额外积分；没有权限会自动跳过
- 适合先跑通，再按需往前补历史

## 方式 B：本地 parquet 快照（更快，适合全量历史）

快照目录需要符合下面的结构（Tushare 原始字段，日期为 `YYYYMMDD` 字符串）：

```
data/snapshot/
├─ trade_cal/all.parquet                 # cal_date, pretrade_date, is_open, exchange
├─ stock_basic/*.parquet                 # ts_code, symbol, name, area, industry, market, exchange,
│                                        # list_status, list_date, delist_date, is_hs, _fetched_at
├─ daily/*.parquet                       # ts_code, trade_date, open, high, low, close,
│                                        # pre_close, pct_chg, vol, amount
├─ adj_factor/*.parquet                  # ts_code, trade_date, adj_factor
├─ daily_basic/*.parquet                 # ts_code, trade_date, turnover_rate, turnover_rate_f,
│                                        # volume_ratio, pe_ttm, pb, total_mv, circ_mv
├─ stk_limit/*.parquet                   # ts_code, trade_date, up_limit, down_limit
├─ limit_list_d/*.parquet                # ts_code, trade_date, industry, name, close, pct_chg, ...
├─ moneyflow/*.parquet                   # ts_code, trade_date, net_mf_amount, buy_lg_amount, ...
├─ margin/*.parquet                      # trade_date, exchange_id, rzye, rzmre, ...
├─ sw_daily/*.parquet                     # ts_code, trade_date, name, close, pct_change, vol, amount, pe, pb, float_mv, total_mv
└─ index_daily/
   ├─ 000300.SH.parquet
   ├─ 000905.SH.parquet
   ├─ 000852.SH.parquet
   └─ 000001.SH.parquet
```

设置环境变量后运行：

```bash
# .env
ASHARE_RADAR_SOURCE=./data/snapshot

python -m pipeline.bootstrap
python -m pipeline.build_marts
```

`bootstrap` 只读取需要的列与时间窗口（默认 2016-12 起），不会全量扫描。

## 数据体积参考

| 内容 | 大小 |
|---|---|
| `core_stock_day`（约 1,000 万行） | 1–2 GB |
| `feat_stock` + marts | 1.5–2 GB |
| 单文件 dashboard（内联字体与数据） | 本轮实测约60.8 MB；随字体、覆盖范围变化 |

## 常见问题

**`lake.duckdb` 被占用**：更新任务和 API 会争抢 DuckDB 文件锁。API 已改为每个请求结束后释放；更新器会等待并重试。详见 [`data_sources.md`](data_sources.md) 第 7 节。

**没有 Tushare 积分**：权限以账户为准；本轮实际账户可访问四类核心数据、资金流、两融和指数，事件接口不可用。首次API建库必须能访问四类核心数据，不能跳过核心失败。可选数据失败记录warning并保留未知值。这不保证其他账户有相同权限。

历史部分日期即使已有行也可能不完整。`pipeline.repair_history` 按局部交易日股票数中位数检测异常偏少日期，只允许在显式指定的现有数据库副本运行；默认生成计划，`--apply` 才联网回补，每日事务提交，失败保留原日数据。该启发式不能证明所有单股漏行或上游错误均已消除。详见最终交付报告。
