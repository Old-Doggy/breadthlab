"""构建分析层：特征表 + 市场/行业/月度聚合。

口径全部集中在 SQL 里，任何页面不得自行重算。
所有金额统一换算为「元」：daily.amount 原始单位千元，moneyflow 原始单位万元。
"""
from __future__ import annotations

import json
import time

from . import settings
from .db import session
from .io_utils import atomic_write_json
from .locking import publish_lock

SQL_VIEW = """
CREATE OR REPLACE VIEW v_stock AS
SELECT d.ts_code,
       d.trade_date,
       d.open, d.high, d.low, d.close, d.pre_close,
       d.pct_chg / 100.0 AS ret,
       d.vol, d.amount,
       d.adj_factor, d.adj_close,
       d.turnover_rate, d.turnover_rate_f, d.volume_ratio,
       d.pe_ttm, d.pb, d.total_mv, d.circ_mv,
       d.up_limit, d.down_limit,
       COALESCE(m.name, d.ts_code) AS name,
       COALESCE(m.industry, '未分类') AS tushare_industry,
       COALESCE(b.sw_l1, '未分类') AS sw_l1,
       CASE WHEN d.ts_code LIKE '%.SH' THEN 'SSE'
            WHEN d.ts_code LIKE '%.SZ' THEN 'SZSE'
            ELSE 'BSE' END AS exchange,
       CASE WHEN d.ts_code LIKE '688%' THEN '科创板'
            WHEN d.ts_code LIKE '300%' OR d.ts_code LIKE '301%' THEN '创业板'
            WHEN d.ts_code LIKE '8%' OR d.ts_code LIKE '4%' OR d.ts_code LIKE '920%' THEN '北交所'
            ELSE '主板' END AS market,
       m.list_date
FROM core_stock_day d
LEFT JOIN core_stock_meta m USING (ts_code)
LEFT JOIN read_csv_auto('{bridge}', header=true) b
       ON m.industry = b.tushare_industry
"""

SQL_FEAT = """
CREATE OR REPLACE TABLE feat_stock AS
WITH calendar AS (
    SELECT trade_date,
           lag(trade_date) OVER (ORDER BY trade_date) AS market_prev_date,
           row_number() OVER (ORDER BY trade_date) AS trade_num
    FROM core_trade_cal WHERE is_open = 1
), listings AS (
    SELECT ts_code, coalesce(try_cast(list_date AS DATE),
           try_strptime(list_date::VARCHAR, '%Y%m%d')::DATE) AS listed_on
    FROM core_stock_meta
), listing_calendar AS (
    SELECT m.ts_code, m.listed_on, min(c.trade_num) AS listing_num
    FROM listings m LEFT JOIN calendar c ON c.trade_date >= m.listed_on
    GROUP BY m.ts_code, m.listed_on
), base AS (
    SELECT s.*, c.market_prev_date, c.trade_num, m.listed_on, m.listing_num,
           row_number() OVER (PARTITION BY s.ts_code ORDER BY s.trade_date) AS n_hist_all,
           lag(s.trade_date) OVER (PARTITION BY s.ts_code ORDER BY s.trade_date) AS observed_prev_date,
           CASE WHEN p.circ_mv > 0 AND isfinite(p.circ_mv) THEN p.circ_mv END AS prev_circ_mv
    FROM v_stock s
    LEFT JOIN calendar c ON c.trade_date = s.trade_date
    LEFT JOIN listing_calendar m ON m.ts_code = s.ts_code
    LEFT JOIN core_stock_day p ON p.ts_code = s.ts_code AND p.trade_date = c.market_prev_date
    WHERE s.exchange IN ('SSE', 'SZSE')
      AND s.market IN ('主板', '创业板', '科创板')
      AND s.ret IS NOT NULL AND isfinite(s.ret) AND s.ret > -1
      AND s.close > 0 AND isfinite(s.close)
      AND s.adj_factor > 0 AND isfinite(s.adj_factor)
      AND s.adj_close > 0 AND isfinite(s.adj_close)
), aged AS (
    SELECT *, CASE
        WHEN listed_on IS NULL THEN true
        WHEN listed_on < (SELECT min(trade_date) FROM calendar) THEN false
        ELSE trade_num - listing_num < 5
        END AS is_new_stock
    FROM base
),
feat AS (
    SELECT *,
           max(adj_close) OVER w252 AS hi252,
           min(adj_close) OVER w252 AS lo252,
           avg(adj_close) OVER w20  AS ma20,
           avg(adj_close) OVER w60  AS ma60,
           avg(adj_close) OVER w250 AS ma250,
           count(adj_close) OVER w252 AS n_hist252,
           CASE WHEN NOT is_new_stock AND up_limit > 0 AND isfinite(up_limit)
                THEN close >= up_limit * 0.999 END AS is_limit_up,
           CASE WHEN NOT is_new_stock AND down_limit > 0 AND isfinite(down_limit)
                THEN close <= down_limit * 1.001 END AS is_limit_down,
           (high = low) AS is_one_word,
           (ret > 0) AS adv,
           (ret < 0) AS dec,
           (ret = 0) AS flat
    FROM aged
    WINDOW w20  AS (PARTITION BY ts_code ORDER BY trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW),
           w60  AS (PARTITION BY ts_code ORDER BY trade_date ROWS BETWEEN 59 PRECEDING AND CURRENT ROW),
           w250 AS (PARTITION BY ts_code ORDER BY trade_date ROWS BETWEEN 249 PRECEDING AND CURRENT ROW),
           w252 AS (PARTITION BY ts_code ORDER BY trade_date ROWS BETWEEN 251 PRECEDING AND CURRENT ROW)
),
flagged AS (
    SELECT *,
           sum(CASE WHEN is_limit_up AND observed_prev_date = market_prev_date THEN 0 ELSE 1 END)
               OVER (PARTITION BY ts_code ORDER BY trade_date
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS lim_grp
    FROM feat
)
SELECT *,
       CASE WHEN is_limit_up THEN
           count(*) FILTER (WHERE is_limit_up)
               OVER (PARTITION BY ts_code, lim_grp ORDER BY trade_date
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
       ELSE 0 END AS limit_streak
FROM flagged
"""

SQL_MARKET = """
CREATE OR REPLACE TABLE mart_market_day AS
WITH f AS (
    SELECT trade_date, ts_code, ret, circ_mv, prev_circ_mv, amount,
           turnover_rate, adv, dec, flat, is_limit_up, is_limit_down, limit_streak,
           adj_close, ma20, ma60, ma250, hi252, lo252, n_hist252, n_hist_all, pre_close, up_limit
    FROM feat_stock
    WHERE NOT is_new_stock
),
w AS (
    SELECT *,
           CASE WHEN prev_circ_mv > 0 THEN prev_circ_mv END AS wcap
    FROM f
),
w2 AS (
    SELECT *,
           wcap / nullif(sum(wcap) OVER (PARTITION BY trade_date), 0) AS weight
    FROM w
),
ret_agg AS (
    SELECT trade_date,
           count(*)                                        AS n_valid,
           count(*) FILTER (WHERE adv)                      AS n_adv,
           count(*) FILTER (WHERE dec)                      AS n_dec,
           count(*) FILTER (WHERE flat)                     AS n_flat,
           avg(ret)                                         AS ew_ret,
           median(ret)                                      AS med_ret,
           quantile_cont(ret, 0.25)                         AS q25,
           quantile_cont(ret, 0.75)                         AS q75,
           quantile_cont(ret, 0.10)                         AS q10,
           quantile_cont(ret, 0.90)                         AS q90,
           stddev_samp(ret)                                 AS csd,
           skewness(ret)                                    AS skew,
           sum(amount) * 1000                               AS amount,
           avg(turnover_rate)                               AS turnover_rate,
           CASE WHEN count(is_limit_up) > 0 THEN count(*) FILTER (WHERE is_limit_up) END AS limit_up_n,
           CASE WHEN count(is_limit_up) > 0 THEN count(*) FILTER (WHERE is_limit_up AND (up_limit / nullif(pre_close, 0) - 1) >= 0.06) END AS limit_up_ex_st_n,
           CASE WHEN count(is_limit_down) > 0 THEN count(*) FILTER (WHERE is_limit_down) END AS limit_down_n,
           CASE WHEN count(is_limit_up) > 0 THEN coalesce(max(CASE WHEN is_limit_up THEN limit_streak END), 0) END AS max_streak_price,
           CASE WHEN count(is_limit_up) > 0 THEN count(*) FILTER (WHERE limit_streak >= 2) END AS streak_n_price,
           CASE WHEN count(is_limit_up) > 0 THEN count(*) FILTER (WHERE limit_streak = 1) END AS first_board_n_price,
           count(*) FILTER (WHERE adj_close >= hi252 AND n_hist252 >= 250) AS new_high_n,
           count(*) FILTER (WHERE adj_close <= lo252 AND n_hist252 >= 250) AS new_low_n,
           count(*) FILTER (WHERE n_hist_all >= 20)          AS n_hist20,
           count(*) FILTER (WHERE n_hist_all >= 60)          AS n_hist60,
           count(*) FILTER (WHERE n_hist252 >= 250)          AS n_hist250,
           count(*) FILTER (WHERE adj_close > ma20 AND n_hist_all >= 20)   AS above_ma20_n,
           count(*) FILTER (WHERE adj_close > ma60 AND n_hist_all >= 60)   AS above_ma60_n,
           count(*) FILTER (WHERE adj_close > ma250 AND n_hist252 >= 250)  AS above_ma250_n
    FROM w2
    GROUP BY trade_date
),
cap_agg AS (
    SELECT trade_date,
           sum(weight * ret)                                AS cw_ret,
           sum(weight * weight) * 10000                     AS hhi,
           sum(weight * ret) FILTER (WHERE rn_w <= 10)       AS top10_contrib,
           sum(abs(weight * ret)) FILTER (WHERE rn_w <= 10) / nullif(sum(abs(weight * ret)), 0) AS top10_share,
           sum(ret) FILTER (WHERE ret > 0 AND rn_r <= ceil(0.05 * n_all)) / nullif(sum(ret) FILTER (WHERE ret > 0), 0) AS gain_share_top5pct,
           max(weight)                                     AS max_weight
    FROM (
        SELECT *,
               row_number() OVER (PARTITION BY trade_date ORDER BY wcap DESC) AS rn_w,
               row_number() OVER (PARTITION BY trade_date ORDER BY ret DESC)  AS rn_r,
               count(*) OVER (PARTITION BY trade_date)                        AS n_all
        FROM w2
    )
    GROUP BY trade_date
),
idx AS (
    SELECT trade_date,
           max(pct_chg) FILTER (WHERE ts_code = '000300.SH') / 100.0 AS hs300_ret,
           max(pct_chg) FILTER (WHERE ts_code = '000905.SH') / 100.0 AS zz500_ret,
           max(pct_chg) FILTER (WHERE ts_code = '000852.SH') / 100.0 AS zz1000_ret,
           max(pct_chg) FILTER (WHERE ts_code = '000001.SH') / 100.0 AS sse_ret
    FROM core_index_day
    GROUP BY trade_date
),
flow AS (
    SELECT trade_date,
           count(*) FILTER (WHERE net_mf_amount > 0)::DOUBLE / nullif(count(net_mf_amount), 0) AS flow_breadth,
           sum(net_mf_amount) * 10000                AS net_mf_amount,
           sum(main_net_amount) * 10000              AS main_net_amount
    FROM core_flow_day JOIN f USING (ts_code, trade_date)
    GROUP BY trade_date
),
margin AS (
    SELECT trade_date, sum(rzye) AS rzye, sum(rzmre) AS rzmre
    FROM core_margin_day
    GROUP BY trade_date
),
lim AS (
    SELECT trade_date,
           sum(is_up)                                        AS limit_up_list_n,
           sum(is_down)                                      AS limit_down_list_n,
           sum(is_broken)                                    AS broken_n,
           max(CASE WHEN is_up THEN limit_times END)          AS max_streak,
           sum(CASE WHEN is_up AND limit_times >= 2 THEN 1 ELSE 0 END) AS streak_n,
           sum(CASE WHEN is_up AND limit_times = 1 THEN 1 ELSE 0 END)  AS first_board_n,
           sum(CASE WHEN is_up THEN fd_amount END)           AS limit_fd_amount
    FROM core_limit_event
    GROUP BY trade_date
)
SELECT r.trade_date,
       r.n_valid, r.n_adv, r.n_dec, r.n_flat,
       r.n_adv::DOUBLE / nullif(r.n_adv + r.n_dec, 0)        AS breadth,
       r.ew_ret, r.med_ret, r.q10, r.q25, r.q75, r.q90,
       (r.q75 - r.q25)                                       AS iqr,
       r.csd, r.skew, r.amount, r.turnover_rate,
       c.cw_ret, c.hhi, c.max_weight,
       c.top10_share,
       c.top10_contrib * 100                                 AS top10_contrib_pct,
       c.gain_share_top5pct,
       (r.ew_ret - c.cw_ret)                                 AS ew_cw_gap,
       r.limit_up_n, r.limit_down_n,
       l.limit_up_list_n, l.limit_down_list_n, l.broken_n,
       r.max_streak_price AS max_streak,
       r.streak_n_price   AS streak_n,
       r.first_board_n_price AS first_board_n,
       l.limit_fd_amount,
       NULL::BIGINT AS limit_up_ex_st_n,
       NULL::BIGINT AS limit_up_st_n,
       r.limit_up_ex_st_n AS limit_up_non5pct_n,
       (r.limit_up_n - r.limit_up_ex_st_n) AS limit_up_5pct_n,
       CASE WHEN l.broken_n IS NOT NULL AND l.limit_up_list_n IS NOT NULL
            THEN l.broken_n::DOUBLE / nullif(l.limit_up_list_n + l.broken_n, 0) END AS broken_rate,
       r.new_high_n, r.new_low_n,
       r.above_ma20_n::DOUBLE / nullif(r.n_hist20, 0)         AS ma20_breadth,
       r.above_ma60_n::DOUBLE / nullif(r.n_hist60, 0)         AS ma60_breadth,
       r.above_ma250_n::DOUBLE / nullif(r.n_hist250, 0)       AS ma250_breadth,
       i.hs300_ret, i.zz500_ret, i.zz1000_ret, i.sse_ret,
       f.flow_breadth, f.net_mf_amount, f.main_net_amount,
       m.rzye, m.rzmre
FROM ret_agg r
LEFT JOIN cap_agg c USING (trade_date)
LEFT JOIN idx i USING (trade_date)
LEFT JOIN flow f USING (trade_date)
LEFT JOIN margin m USING (trade_date)
LEFT JOIN lim l USING (trade_date)
ORDER BY r.trade_date
"""

SQL_SECTOR_DAY = """
CREATE OR REPLACE TABLE mart_sector_day AS
WITH f AS (
    SELECT trade_date, sw_l1, ret, prev_circ_mv, amount, adv, dec,
           turnover_rate, is_limit_up
    FROM feat_stock
    WHERE NOT is_new_stock AND sw_l1 <> '未分类'
),
w AS (
    SELECT *,
           CASE WHEN prev_circ_mv > 0 THEN prev_circ_mv END AS wcap
    FROM f
),
w2 AS (
    SELECT *,
           wcap / nullif(sum(wcap) OVER (PARTITION BY trade_date, sw_l1), 0) AS weight
    FROM w
)
SELECT trade_date, sw_l1,
       count(*)                                          AS n,
       count(*) FILTER (WHERE adv)                        AS n_adv,
       count(*) FILTER (WHERE dec)                        AS n_dec,
       count(*) FILTER (WHERE adv)::DOUBLE / nullif(count(*) FILTER (WHERE adv) + count(*) FILTER (WHERE dec), 0) AS breadth,
       avg(ret)                                          AS ew_ret,
       median(ret)                                       AS med_ret,
       sum(weight * ret)                                 AS cw_ret,
       quantile_cont(ret, 0.10)                          AS q10,
       quantile_cont(ret, 0.25)                          AS q25,
       quantile_cont(ret, 0.75)                          AS q75,
       quantile_cont(ret, 0.90)                          AS q90,
       (quantile_cont(ret, 0.75) - quantile_cont(ret, 0.25)) AS iqr,
       stddev_samp(ret)                                  AS csd,
       sum(amount) * 1000                                AS amount,
       avg(turnover_rate)                                AS turnover_rate,
       CASE WHEN count(is_limit_up) > 0 THEN count(*) FILTER (WHERE is_limit_up) END AS limit_up_n
FROM w2
GROUP BY trade_date, sw_l1
ORDER BY trade_date, sw_l1
"""

SQL_SECTOR_RANK = """
CREATE OR REPLACE TABLE mart_sector_rank AS
WITH s AS (
    SELECT trade_date, sw_l1, ew_ret,
           CASE WHEN count(ew_ret) OVER (
               PARTITION BY sw_l1 ORDER BY trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
           ) = 20 THEN exp(sum(ln(1 + ew_ret)) OVER (
               PARTITION BY sw_l1 ORDER BY trade_date
               ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
           )) - 1 END AS ret20
    FROM mart_sector_day
)
SELECT trade_date, sw_l1, ret20,
       rank() OVER (PARTITION BY trade_date ORDER BY ret20 DESC) AS rank20
FROM s
WHERE ret20 IS NOT NULL
ORDER BY trade_date, rank20
"""

SQL_ROTATION = """
CREATE OR REPLACE TABLE mart_rotation_day AS
WITH d AS (
    SELECT trade_date, sw_l1, rank20,
           lag(rank20) OVER (PARTITION BY sw_l1 ORDER BY trade_date) AS prev_rank
    FROM mart_sector_rank
)
SELECT trade_date,
       avg(abs(rank20 - prev_rank)) AS rotation_intensity,
       count(*)                     AS n_sectors
FROM d
WHERE prev_rank IS NOT NULL
GROUP BY trade_date
ORDER BY trade_date
"""

SQL_LIMIT_QUALITY = """
CREATE OR REPLACE TABLE mart_limit_quality AS
SELECT trade_date,
       count(*) FILTER (WHERE is_up)                                   AS n_limit_up,
       median(CASE WHEN is_up AND float_mv > 0 AND fd_amount > 0 THEN fd_amount / float_mv END) AS fd_ratio,
       avg(CASE WHEN is_up THEN open_times END)                        AS avg_open_times,
       count(*) FILTER (WHERE is_up AND open_times > 0)::DOUBLE /
           nullif(count(*) FILTER (WHERE is_up), 0)                    AS open_share
FROM core_limit_event
GROUP BY trade_date
ORDER BY trade_date
"""

SQL_MONTH = """
CREATE OR REPLACE TABLE mart_market_month AS
SELECT date_trunc('month', trade_date)::DATE AS month,
       count(*)                    AS n_days,
       sum(n_valid)                AS n_valid,
       avg(breadth)                AS breadth,
       avg(ew_ret)                 AS ew_ret,
       avg(cw_ret)                 AS cw_ret,
       avg(med_ret)                AS med_ret,
       avg(csd)                    AS csd,
       sum(amount)                 AS amount,
       avg(hhi)                    AS hhi,
       avg(top10_share)            AS top10_share,
       exp(sum(ln(1 + ew_ret))) - 1 AS ew_ret_cum,
       CASE WHEN count(hs300_ret) = count(*) THEN exp(sum(ln(1 + hs300_ret))) - 1 END AS hs300_ret_cum,
       count(hs300_ret) AS hs300_n_days
FROM mart_market_day
GROUP BY 1 ORDER BY 1
"""

SQL_SECTOR_MONTH = """
CREATE OR REPLACE TABLE mart_sector_month AS
SELECT date_trunc('month', trade_date)::DATE AS month, sw_l1,
       count(*)          AS n_days,
       avg(breadth)      AS breadth,
       avg(ew_ret)       AS ew_ret,
       avg(cw_ret)       AS cw_ret,
       avg(iqr)          AS iqr,
       sum(amount)       AS amount,
       exp(sum(ln(1 + ew_ret))) - 1 AS ew_ret_cum
FROM mart_sector_day
GROUP BY 1, 2 ORDER BY 1, 2
"""

SQL_LATEST = """
CREATE OR REPLACE TABLE mart_stock_latest AS
WITH last_day AS (SELECT max(trade_date) AS d FROM feat_stock)
SELECT f.ts_code, f.name, f.sw_l1, f.market, last_day.d AS trade_date,
       f.trade_date AS quote_date, NULL::BOOLEAN AS is_suspended,
       f.trade_date < last_day.d AS is_stale,
       f.close, CASE WHEN f.trade_date = last_day.d THEN f.pre_close ELSE f.close END AS pre_close,
       CASE WHEN f.trade_date = last_day.d THEN f.ret ELSE 0 END AS ret,
       f.circ_mv, f.total_mv, f.turnover_rate, f.pe_ttm, f.pb,
       CASE WHEN f.trade_date = last_day.d THEN f.amount * 1000 ELSE 0 END AS amount,
       CASE WHEN f.trade_date = last_day.d THEN f.is_limit_up ELSE false END AS is_limit_up,
       CASE WHEN f.trade_date = last_day.d THEN f.is_limit_down ELSE false END AS is_limit_down
FROM feat_stock f, last_day
QUALIFY row_number() OVER (PARTITION BY f.ts_code ORDER BY f.trade_date DESC) = 1
"""

STEPS = [
    ("v_stock", SQL_VIEW),
    ("feat_stock", SQL_FEAT),
    ("mart_market_day", SQL_MARKET),
    ("mart_sector_day", SQL_SECTOR_DAY),
    ("mart_limit_quality", SQL_LIMIT_QUALITY),
    ("mart_sector_rank", SQL_SECTOR_RANK),
    ("mart_rotation_day", SQL_ROTATION),
    ("mart_market_month", SQL_MONTH),
    ("mart_sector_month", SQL_SECTOR_MONTH),
    ("mart_stock_latest", SQL_LATEST),
]


def run(only: list[str] | None = None) -> dict:
    bridge = (settings.ROOT / "config" / "industry_bridge.csv").as_posix().replace("'", "''")
    report = {}
    with publish_lock(), session(wait=True, timeout_sec=600) as con:
        con.execute("BEGIN TRANSACTION")
        try:
            for name, sql in STEPS:
                if only and not any(o in name for o in only):
                    continue
                t0 = time.time()
                print(f"[marts] {name} ...", flush=True)
                con.execute(sql.format(bridge=bridge) if "{bridge}" in sql else sql)
                rows = con.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
                sec = round(time.time() - t0, 1)
                report[name] = {"rows": int(rows), "sec": sec}
                print(f"[marts] {name}: {rows:,} rows in {sec}s", flush=True)
            con.execute("COMMIT")
        except BaseException:
            con.execute("ROLLBACK")
            raise
    atomic_write_json(settings.META / "marts.json", report)
    return report


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--only", action="append")
    args = ap.parse_args()
    print(json.dumps(run(args.only), ensure_ascii=False, indent=2))
