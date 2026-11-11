# 数据准备

仓库不包含任何行情数据。你可以用两种方式构建本地 `data/lake.duckdb`。

## 方式 A：Tushare API（推荐给第一次跑的人）

```bash
python -m pipeline.bootstrap_api --start 20240101
python -m pipeline.build_marts
```

- 每个交易日调用 7 个接口，历史越长越慢
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
└─ index_daily/
   ├─ 000300.SH.parquet
   ├─ 000905.SH.parquet
   ├─ 000852.SH.parquet
   └─ 000001.SH.parquet
```

设置环境变量后运行：

```bash
# .env
BREADTHLAB_SOURCE=./data/snapshot

python -m pipeline.bootstrap
python -m pipeline.build_marts
```

`bootstrap` 只读取需要的列与时间窗口（默认 2016-12 起），不会全量扫描。

## 数据体积参考

| 内容 | 大小 |
|---|---|
| `core_stock_day`（约 1,000 万行） | 1–2 GB |
| `feat_stock` + marts | 1.5–2 GB |
| 单文件 dashboard（内联字体与数据） | 15–35 MB |

## 常见问题

**`lake.duckdb` 被占用**：更新任务和 API 会争抢 DuckDB 文件锁。API 已改为每个请求结束后释放；更新器会等待并重试。详见 [`data_sources.md`](data_sources.md) 第 7 节。

**没有 Tushare 积分**：`daily`、`daily_basic`、`adj_factor`、`stk_limit` 需要 2000 积分；`limit_list_d`、`moneyflow` 需要更多。没有权限时对应数据集会跳过，页面对应位置显示 `—`。
