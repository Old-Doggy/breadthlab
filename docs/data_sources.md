# 数据源与降级策略

## 1. 现状：主源 + 免费备用源

| 数据集 | 主源 | 备用源 | 备用源覆盖 | 说明 |
|---|---|---|---|---|
| `daily` OHLCV | Tushare | **akshare**（东方财富快照） | ✅ 全市场 | 收盘后快照 |
| `daily_basic` 市值/换手/PE/PB | Tushare | **akshare** | ✅ 全市场 | 流通市值覆盖率 100% |
| `stk_limit` 涨跌停价 | Tushare | **akshare**（按昨收+板块规则计算） | ✅ 全市场 | ST 5%、主板 10%、双创 20% |
| `adj_factor` 复权因子 | Tushare | **akshare**（前一日顺延） | ✅ 99.93% | 除权日会偏一天 |
| `limit_list_d` 涨停明细 | Tushare（无权限） | — | ❌ | 涨停/连板已改用价格判定 |
| `moneyflow` 资金流 | Tushare | — | ❌ | 页面显示 `—` |
| `margin` 两融 | Tushare | — | ❌ | T+1 发布 |
| `index_daily` 指数 | akshare | Tushare | ✅ | 主源已是 akshare |
| `trade_cal` 日历 | Tushare | akshare | ✅ | 仅备用源模式使用 |

> 本地快照 `./data/snapshot` 也是 Tushare 导出，**不算独立源**；
> akshare 走东方财富，与 Tushare 是不同的上游。

## 2. 降级逻辑

`pipeline/update_daily.py` 每个数据集独立降级：

```
Tushare 成功 → 写入，source=tushare
Tushare 抛错/空 → akshare 快照 → 写入，source=akshare，并记 warning
两者都失败 → 跳过该数据集，继续下一个（不阻断当日更新）
```

- 默认 `--source auto`：上面的行为
- `--source tushare`：只用主源，失败即报错（严格模式）
- `--source akshare`：跳过 Tushare，直接用备用源（用于演练/应急）
- `--source akshare --dry-run`：只探测各数据集行数，不写库

`data/meta/status.json` 的 `sources` 字段会记录每个数据集**实际使用**的源。

## 3. 验证结果（2026-11-11）

**跨源一致性**：把 akshare 快照的「昨收」与 Tushare 11-10 收盘价比对：

- 匹配 5,573 只，**99.86% 差异 < 0.01 元**，MAE 0.0003 元
- 0.14% 不匹配主要是当日除权（昨收已被交易所调整）

**写入演练**（临时库，不碰主库）：

- `daily` 写入 5,577 行，平均涨跌 +1.14%
- 流通市值覆盖 5,577 / 5,577（100%）
- 涨停价覆盖 5,577 / 5,577（100%）
- 复权因子顺延覆盖 5,573 / 5,577（4 只新股无前值）

## 4. 已知限制

1. **只能补当天**：快照是实时行情，收盘后取当日；历史回补仍需 Tushare 或本地快照。
2. **复权因子顺延**：若当日恰好除权，`adj_close` 会偏一天（月度收益端点受影响，日频不受影响）。
3. **涨跌停价为计算值**：按昨收 × (1±幅度) 四舍五入，可能与交易所精确值差 0.01 元；ST/新股规则已按名称与板块处理。
4. **资金流/两融/涨停明细缺失**：对应图表显示 `—`，质量门禁会记录 warning。
5. 快照单次约 60–70 秒（59 页分页），进程内缓存一次。

## 5. 手动命令

```powershell
# 探测备用源（不写库，约 70 秒）
python -m pipeline.update_daily --source akshare --dry-run

# 应急：用备用源写当天
python -m pipeline.update_daily --source akshare --date 20261111

# 跨源一致性检查
python scripts/probe_akshare.py

# 备用源写入演练（临时库）
python scripts/test_fallback_insert.py
```

## 6. 后续可选

- 接入 **baostock**（免费、独立上游）做历史回补的第二源
- `moneyflow` 用 akshare `stock_individual_fund_flow_rank` 兜底
- `margin` 用交易所公开文件兜底

## 7. 并发与锁（更新任务 vs API）

DuckDB 同一时刻只允许一个写连接；旧版 API 常驻只读连接，会挡住 17:35 的更新。

现在的行为：

| 角色 | 连接方式 | 冲突时 |
|---|---|---|
| Flask API | 每请求一个只读连接，请求结束关闭 | 更新器持锁 → 返回 503 + `Retry-After: 10` |
| 更新任务 | 写连接，`connect_wait` 最多等 300–600 秒 | 等 API 请求间隙拿锁 |
| 导出 / 简报 | 只读 | 与更新互斥，排在更新之后 |

运维要点：

- 升级后**重启一次** `python -m backend.main`，旧进程的常驻连接才会释放。
- 更新期间页面可能短暂提示“数据更新中”，属预期。
- 若 10 分钟仍拿不到锁，检查是否有其它进程（DBeaver、另一个 Python）占着 `lake.duckdb`。
- 等待超时可用环境变量调整：`$env:BREADTHLAB_LOCK_TIMEOUT = "600"`。