# 指标口径（全站唯一）

所有指标在 `pipeline/build_marts.py` 中实现一次，前端与 API 不再重算。

## 样本

- 股票池：`SSE`/`SZSE` 的 主板 + 创业板 + 科创板；北交所默认排除。
- 有效样本：当日有行情行、`close>0`、`adj_factor>0`、`ret` 非空。
- 剔除：上市前 5 个交易日（`n_hist_all <= 5`）。
- 停牌：无行情行，不计入分母；不补造收益。

## 收益

| 名称 | 公式 | 备注 |
|---|---|---|
| 日收益 | `pct_chg / 100` | 与 `close/pre_close-1` 交叉校验 |
| 复权收盘 | `close × adj_factor` | 用于 MA / 新高 / 区间收益 |
| 等权收益 | `mean(ret)` | 主口径 |
| 市值加权 | `Σ wᵢrᵢ`，`wᵢ = circ_mv_{t-1} / Σ circ_mv_{t-1}` | 用前一日市值避免同日内生 |
| 中位数 | `median(ret)` | 抗极值 |

## 广度

- `breadth = N(ret>0) / (N(ret>0) + N(ret<0))`，平盘剔除。
- `ma20_breadth / ma60_breadth / ma250_breadth = N(adj_close > MA) / N(有足够历史)`：
  分母分别要求 `n_hist_all ≥ 20 / ≥ 60 / n_hist252 ≥ 250`，避免新股用不完整窗口的均线。

## 集中度

- `hhi = Σ wᵢ² × 10000`。
- `top10_share = Σ_{Top10权重} |wᵢrᵢ| / Σ|wᵢrᵢ|`（有界 0–1，避免分母接近 0 时爆表）。
- `top10_contrib_pct = Σ_{Top10权重} wᵢrᵢ × 100`（pp）。
- `gain_share_top5pct = 涨幅前 5% 股票的正收益之和 / 全部正收益之和`。

## 分化

- `csd = stddev_samp(ret)`（pp）。
- `iqr = q75 − q25`（pp）。
- `ew_cw_gap = ew_ret − cw_ret`（大小盘/权重分化代理）。

## 情绪

- 涨停：`close ≥ up_limit × 0.999`；跌停：`close ≤ down_limit × 1.001`（`stk_limit` 真实价）。
- `limit_up_n` 为价格口径，**含 ST/风险警示股**（5% 涨停）；`limit_up_ex_st_n` 为剔除 5% 涨停后的口径，与 Tushare `limit_list_d` 可比；`limit_up_st_n = limit_up_n - limit_up_ex_st_n`。
- 炸板率：`broken_rate = broken / (limit_up_list_n + broken)`，分子分母都来自 `limit_list_d`（官方口径，不含 ST）；无权限时为空。
- 连板：`limit_times` 的最大值；`streak_n = count(limit_times ≥ 2)`。
- 新高/新低：`adj_close ≥ 252 日最高` / `≤ 252 日最低`，需 ≥250 日历史。

## 状态分类

| 状态 | 条件 |
|---|---|
| 普涨 | `ew_ret > 0` 且 `breadth ≥ 0.60` |
| 集中上涨 | `ew_ret > 0` 且 `breadth < 0.45` |
| 结构分化 | 其余 |
| 普跌 | `ew_ret ≤ 0` 且 `breadth < 0.45` |

阈值固定，不随图形调整；页面同时保留连续值，避免把四类当自然规律。
