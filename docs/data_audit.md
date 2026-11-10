# 数据体检（2026-11-10）

数据源：本地快照 `./data/snapshot`（2014-01-02 → 2026-05-22）+ Tushare Pro 增量（2026-05-25 → 2026-11-10）。
股票池：沪深主板 / 创业板 / 科创板（北交所排除）。

## 1. 规模

| 表 | 行数 | 说明 |
|---|---:|---|
| `core_stock_day` | 10,224,195 | daily + adj_factor + daily_basic + stk_limit |
| `core_flow_day` | 10,433,188 | 资金流 |
| `core_limit_event` | 155,289 | 涨跌停事件（仅快照期；新数据无该接口权限） |
| `core_stock_meta` | 5,923 | 含退市 / 暂停上市 |
| `feat_stock` | 9,882,294 | 复权、MA、新高、涨跌停、连板 |
| `mart_market_day` | 2,408 | 2016-12-08 → **2026-11-10** |
| `mart_sector_day` | 74,417 | 31 个申万一级 |
| `mart_stock_latest` | 5,218 | 最新交易日快照 |

## 2. 增量更新（2026-05-25 → 2026-11-10）

- 114 个交易日，耗时 **491 秒**，质量门禁全部通过。
- 每日新增约 5,500 只股票，`daily / daily_basic / adj_factor / stk_limit / moneyflow` 全部成功。
- **`limit_list_d` 无接口权限**：新数据的炸板率显示为 `—`；涨停家数、连板高度改由
  `stk_limit` 真实涨跌停价 + 连续涨停天数（gaps-and-islands）计算，口径一致且完整。
- 指数用 akshare 补齐到 2026-11-10，`hs300_ret` 不再缺失。\n- 两融（`margin`）已回填，T+1 发布，最新一日（11-10）为空属正常。

## 3. 最新交易日（2026-11-10）

- 有效样本 **5,217**，上涨 4,002 / 下跌 1,073，广度 **78.9%**，等权收益 **+1.79%**。
- 涨停 95 / 跌停 1，连板 20 家，最高 7 板，首板 75 家。
- 行业映射覆盖 **99.98%**（5,218 只中 1 只未分类）。

## 4. 已知坑与处理

| 坑 | 证据 | 处理 |
|---|---|---|
| `index_member_all` 只有 1 行 | 目录仅 1 文件 | 弃用，改静态桥接表（110 → 31） |
| `bak_basic.industry` 漂移 | 抽样 200 只中 119 只标签变化 | 不用作主映射 |
| 北向口径断裂 | 2024-08-19 后为成交额而非净买入 | 不做跨期序列 |
| `stk_factor_pro` 23 GB | 单文件 | 不读 |
| 快照停更 | 2026-05-22 | 已用 Tushare 增量补齐 |
| `limit_list_d` 权限 | 5000 积分账号无权限 | 用价格判定 + 连板算法替代 |
| 新股首日极端收益 | 注册制首日无涨跌幅 | 上市前 5 日剔除出市场聚合 |

## 5. 复现

```powershell
python -m pipeline.bootstrap        # 快照 -> core（一次性）
python -m pipeline.update_daily     # 增量
python -m pipeline.refresh_meta     # 新股/退市
python -m pipeline.build_marts
python -m pipeline.export_static
```
