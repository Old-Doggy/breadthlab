# 数据源与降级策略

## 1. 现状：主源 + 免费备用源

| 数据集 | 主源 | 备用源 | 备用源覆盖 | 说明 |
|---|---|---|---|---|
| `daily` OHLCV | Tushare | **akshare**（东方财富快照） | ✅ 全市场 | 收盘后快照 |
| `daily_basic` 市值/换手/PE/PB | Tushare | **akshare** | 部分字段 | 动态PE不冒充TTM；自由流通换手率留空 |
| `stk_limit` 涨跌停价 | Tushare | **akshare**（按昨收+板块规则计算） | ✅ 全市场 | ST 5%、主板 10%、双创 20% |
| `adj_factor` 复权因子 | Tushare | **akshare**（最后有效因子顺延） | 有历史有效值的股票 | 除权期间可能持续偏差；覆盖须重新验质 |
| `limit_list_d` 涨停明细 | Tushare（无权限） | — | ❌ | 涨停/连板已改用价格判定 |
| `moneyflow` 资金流 | Tushare | — | ❌ | 页面显示 `—` |
| `margin` 两融 | Tushare | — | ❌ | T+1 发布 |
| `index_daily` 指数 | Tushare | — | 标准更新无备用 | 单独手动回补脚本不等于自动降级 |
| `trade_cal` 日历 | Tushare | akshare | ✅ | 仅备用源模式使用 |

> 本地快照 `./data/snapshot` 也是 Tushare 导出，**不算独立源**；
> akshare 走东方财富，与 Tushare 是不同的上游。

## 2. 降级逻辑

`pipeline/update_daily.py` 每个数据集独立降级：

```
Tushare 成功 → 写入，source=tushare
Tushare 抛错/空 → 当天收盘后akshare快照 → 写入，source=akshare，记warning并安排主源重试
核心数据集缺失 → 当日失败回滚，旧数据不能冒充本次成功；可选数据集缺失 → warning并独立回补
```

- 默认 `--source auto`：上面的行为
- `--source tushare`：只用主源，任一请求失败/为空即失败（严格演练模式；两融T+1或无权限事件也会失败）
- `--source akshare`：跳过 Tushare，直接用备用源（用于演练/应急）
- `--source akshare --dry-run`：只列待处理日期，不请求行情、不写库

`data/meta/status.json` 的 `sources` 字段会记录每个数据集**实际使用**的源。

## 3. 历史验证记录（2026-11-11，本轮未复核，不代表当前修复版实测）

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
2. **复权因子顺延**：除权期间MA/新高可能失真，连续降级偏差可持续；不承诺“只偏一天”。来源被标记，主源恢复后重新请求降级日期。
3. **涨跌停价为计算值**：支持301创业板；上市前5日及上市信息不明时不伪造限价。特殊重新上市等规则仍需上游真实限价；普通规则计算可能差0.01元。
4. **资金流/两融/涨停明细缺失**：更新报告记录warning，前端保留未知值，状态栏提示数据告警。实测事件接口不可用，不能宣称已补齐。
5. 快照单次约 60–70 秒（59 页分页），进程内缓存一次。

## 5. 手动命令

```powershell
# 仅计划日期（可能查询日历，不请求行情、不写库）
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
