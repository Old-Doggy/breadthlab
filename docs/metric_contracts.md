# 指标口径（全站唯一）

核心指标在 `pipeline/build_marts.py` 中实现。前端展示聚合遵循本契约；静态月频直接消费导出的月表，离线包没有覆盖的明细明确报缺失。验证范围及限制见 `release_completion_report.md`。

## 样本

- 股票池：`SSE`/`SZSE` 的 主板 + 创业板 + 科创板；北交所默认排除。
- 有效样本：当日有行情行，close、adj_factor、adj_close 为正且有限，ret 有限且大于 -1。
- 剔除：按 list_date 和交易日历计算的上市前 5 个交易日。缺上市日期不得发布；n_hist_all 仅表示已加载有效观察数。
- 停牌：无行情行，不计入分母；不补造收益。
- ST 不因名称被排除。EW、CSD、IQR、q10/q90包含平盘，breadth仅在分母剔除平盘；均使用上述有效且非新股池。

## 收益

| 名称 | 公式 | 备注 |
|---|---|---|
| 日收益 | `pct_chg / 100` | 与 `close/pre_close-1` 交叉校验 |
| 复权收盘 | `close × adj_factor` | 用于 MA / 新高；市场区间收益为日 EW 复利 |
| 等权收益 | `mean(ret)` | 主口径 |
| 市值加权 | `Σ wᵢrᵢ`，`wᵢ = circ_mv_{t-1} / Σ circ_mv_{t-1}` | t-1 为上一市场交易日，当日有收益且前日正权重的股票内归一；缺前日行情退出加权，不沿用旧权重 |
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
- 无有效权重时CW/HHI为空；全平盘时breadth和Top10波动占比为空，不补0。

## 分化

- `csd = stddev_samp(ret)`，存储为收益小数，显示 pp 时乘100。
- `iqr = q75 − q25`，存储为收益小数，显示 pp 时乘100。
- `ew_cw_gap = ew_ret − cw_ret`（大小盘/权重分化代理）。

## 情绪

- 涨停：`close ≥ up_limit × 0.999`；跌停：`close ≤ down_limit × 1.001`（`stk_limit` 真实价）。
- `limit_up_n` 为价格口径，包含 ST。`limit_up_non5pct_n` / `limit_up_5pct_n` 区分非5%和5%限制；旧 `limit_up_ex_st_n` / `limit_up_st_n` 保留字段但返回 NULL，**不是 ST 身份统计**。全缺限价时返回空，不伪造0家。
- 炸板率：`broken_rate = broken / (limit_up_list_n + broken)`，分子分母都来自 `limit_list_d`（官方口径，不含 ST）；无权限时为空。
- 连板：按价格判定的连续市场交易日涨停数；停牌/缺行情日中断。首板=1、streak_n 为>=2；不使用官方 limit_times。
- 新高/新低：`adj_close ≥ 252 日最高` / `≤ 252 日最低`，需 ≥250 日历史。

## 状态分类

| 状态 | 条件 |
|---|---|
| 普涨 | `ew_ret > 0` 且 `breadth ≥ 0.50` |
| 集中上涨 | `ew_ret > 0` 且 `breadth < 0.50` |
| 结构分化 | `ew_ret ≤ 0` 且 `breadth ≥ 0.50` |
| 普跌 | `ew_ret ≤ 0` 且 `breadth < 0.50` |

阈值固定，不随图形调整；页面同时保留连续值，避免把四类当自然规律。

## 月度与持仓

月表 ew_ret/cw_ret 是日收益平均值，ew_ret_cum 才是每日EW复利。指数月累计缺任一日即空。
行业 ret20 需完整20条日观察。持仓池保留每股最后报价，quote_date 标记报价日；无当日行情时 is_stale=true、当日ret/amount按0标记，但前端据此将今日盈亏与组合日收益显示为未知，不当作平盘。is_suspended 为 null，因为缺报价不能证明停牌。今日盈亏=股数×(close−pre_close)，组合日收益=Σ今日盈亏/Σ期初市值；假设股数不变，不含交易和现金分红。
资金流仅汇总同一有效市场样本中有资金流记录的股票，缺记录不补0。
