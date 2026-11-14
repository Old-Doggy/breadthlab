# 决策记录（ADR）

当前发布链、样本和门禁变更见 [ADR-11](decisions/ADR-11-release-integrity.md)。旧记录中的9门禁与月度端点描述已被更正，不作为当前实现证明。

格式：背景 → 选项 → 决定 → 后果。只记录**会影响口径或架构**的决定。

---

## ADR-01 股票池：沪深主板 + 创业板 + 科创板，排除北交所

**背景**：本地快照含 BSE 312 只，流动性与涨跌幅规则（30%）与主板差异大，混入会污染广度与涨跌停统计。

**选项**：A) 全市场含 BSE；B) 仅沪深 A 股；C) 沪深为主、BSE 可切换。

**决定**：B，`exchange IN ('SSE','SZSE') AND market IN ('主板','创业板','科创板')`；BSE 在 `stock_meta` 保留但不入主池。

**后果**：样本约 5,200 只；与主流指数口径一致。BSE 专题需单独开池，当前不做。

---

## ADR-02 收益口径：官方 `pct_chg` 为主，`close/pre_close` 校验

**背景**：`pct_chg` 与 `close/pre_close-1` 理论上等价，但除权、停牌、数据源差异会造成偏离。

**选项**：A) 全部用 `close/pre_close` 重建；B) 全部用官方 `pct_chg`；C) 官方为主 + 校验。

**决定（端点法部分已由 ADR-11 更正）**：C。差异 >0.1pp 纳入质量门禁（阈值 <1%）；当前月/市场区间为日EW复利，非adj_close端点。

**后果**：日频与官方一致；月频避免分红除权失真。极端值保留原值，图表按 ±11% 截尾并注明。

---

## ADR-03 行业映射：静态桥接表，承认前视偏差

**背景**：`index_member_all` 本地只有 1 行；`bak_basic.industry` 124 类且抽样 200 只中 119 只标签漂移；直接展示会误导。

**选项**：A) 用 `bak_basic` 逐日标签；B) 用 Tushare `stock_basic.industry` 静态标签 + 人工桥接到 31 个申万一级；C) 只用有申万成分的股票。

**决定**：B。`config/industry_bridge.csv` 维护 110 → 31 映射，覆盖 99.98%；未映射记“未分类”。

**后果**：行业归属是**当前**分类回填历史，存在前视偏差；已在 About/README 标注。升级路径：拿到 `index_member_all` 权限后改为 PIT 成员。

---

## ADR-04 加权与集中度：市值权重用前一日 `circ_mv`

**背景**：用当日 `circ_mv` 加权会把当日涨跌内生到权重里，放大动量。

**决定**：`w_i = circ_mv_{t-1} / Σ circ_mv_{t-1}`；`HHI = Σw²×10000`；Top10 用**有界**的 `Σ|w·r| / Σ|w·r|`，避免 `CW→0` 时比值爆表。

**后果**：早期上市不足两日的股票权重缺失，自动退出加权口径（等权不受影响）。

---

## ADR-05 北向资金：剔除跨期序列

**背景**：2024-08-19 后 `moneyflow_hsgt.north_money` 由“净买入”变为“成交额”，之后 410 个交易日全为正、量级 30–43 亿，跨期不可比。

**决定**：不做北向时间序列；如需展示只保留 2024-08-19 前区间并显式标注断点。

**后果**：少一个宏观维度，但避免了一个必然误读的图。

---

## ADR-06 连板高度：改用价格判定 + 连续涨停天数

**背景**：5000 积分账号**无 `limit_list_d` 权限**，新数据拿不到 `limit_times`；旧数据有，直接拼会造成断崖。

**选项**：A) 新数据留空；B) 用 akshare 涨停池补；C) 用 `stk_limit` 判定涨停并自行计算连续天数。

**决定**：C。`is_limit_up = close ≥ up_limit×0.999`，用 gaps-and-islands 计算 `limit_streak`；`max_streak/streak_n/first_board_n` 全部改为价格口径，历史与新数据一致。

**后果**：炸板率（依赖 `limit_list_d` 的 Z 记录）在新数据上显示 `—`；涨停/连板/首板完整。

---

## ADR-07 质量门禁：9 条，block / warn 分级

**背景**：规格要求“任一失败阻断发布”，但广度日变化 30pp 在真实行情里会出现（如 2026-11-10 从 40% 跳到 79%），一律阻断会误杀。

**决定**：1/2/3/4/5/7 为 block；6/8/9 为 warn。block 失败停止发布并在 `status.json` 记 `failed`；warn 写入 `quality/YYYYMMDD.json` 供 About 查看。

**对第 9 条的解释**：规格原文“与昨日 mart 重算值差异”在增量场景不可用（mart 尚未重建），落地为**日环比连续性**（|ΔEW| ≤ 8pp），用于捕捉数据错位而非行情波动。

**后果**：2026-11-10 的 8/9 通过，广度合理性（+38pp）为 warn，符合预期。

---

## ADR-08 API：FastAPI → Flask

**背景**：当前 Windows 沙箱内 `asyncio.new_event_loop()` 挂死，uvicorn/FastAPI 无法启动；本机服务是硬需求。

**决定**：改用 Flask（同步、线程池），路由与响应结构保持不变；数据层与前端无感知。

**后果**：失去 OpenAPI 自动文档；换来本机稳定运行。若部署到正常环境，可按原路由 1:1 迁回 FastAPI。

---

## ADR-09 简报：Playwright → 无头 Edge

**背景**：Playwright 依赖 asyncio，同一沙箱不可用；Edge/Chrome 的 `--print-to-pdf` 可直接渲染单文件页面。

**决定**：`scripts/briefing.ps1` 用 `Start-Process` 调 Edge，先把单文件复制到 **ASCII 临时路径**（中文路径会让 Edge CLI 失败），再拷回 `data/snapshots/YYYYMMDD/`；脚本存为 UTF-8 BOM 以兼容 Windows PowerShell 5.1。

**后果**：PDF 与页面视觉一致；简报失败只告警，不阻断数据更新。

---

## ADR-10 备用数据源：akshare 快照，逐数据集降级

**背景**：核心数据几乎全部来自 Tushare；积分不足、限流或故障会直接断更。本地快照同样是 Tushare 导出，不能算独立源。

**选项**：A) 只用 Tushare，接受断更；B) 接入 akshare/东方财富做当日降级；C) 接入 baostock 做历史第二源。

**决定**：B。`daily`、`daily_basic`、`stk_limit`、`adj_factor` 四个数据集由 akshare 全市场快照兜底；逐数据集 `auto` 降级，`status.json` 记录实际来源。C 作为后续可选。

**后果**：
- 当日广度、涨跌停、市值加权不会因 Tushare 故障而缺失
- 复权因子用前一日顺延，除权日会偏一天
- 涨跌停价为规则计算值，可能与交易所差 0.01 元
- 资金流、两融、涨停明细仍只有 Tushare，缺失时显示 `—`
- 快照只能补当天，历史回补仍依赖 Tushare/本地快照

---

## ADR-11 并发模型：API 按请求持锁、更新器等锁、更新中返回 503

**背景**：Flask API 若常驻一个只读 DuckDB 连接，会一直占着文件锁，17:35 的更新任务无法打开写连接。2026-11-11 实测确认：更新直接报 `Cannot open file ... being used`，当天数据断更。

**选项**：
- A) 更新时先停 API，更新完再启动：简单，但需要进程编排，且用户会看到服务中断。
- B) API 改读导出的 parquet：彻底解耦，但要重写所有查询与导出，改动过大。
- C) API 每请求开只读连接、请求结束释放；更新器等锁；更新期间 API 返回 503。

**决定**：C。

**实现**：
- `backend/main.py`：`con()` 使用 Flask `g`，`teardown_appcontext` 关闭连接。
- `pipeline/db.py`：`connect_wait()` 识别 DuckDB 锁错误，每 5 秒重试，默认 300 秒（`ASHARE_RADAR_LOCK_TIMEOUT` 可调），日志打印等待进度。
- `update_daily` / `build_marts` / `refresh_status` / `bootstrap`：写会话使用 `session(wait=True)`。
- API 捕获 `duckdb.Error` 返回 `503 + Retry-After: 10`。
- 前端查询 3 次指数退避重试（1/2/4s），并显示“数据更新中”提示。

**验证**（2026-11-11）：
- API 请求返回 200 后，写连接立即可用。
- 持有写锁时 API 返回 503 `{"error": "database busy"}`。
- 旧进程持锁时，`connect_wait` 按预期等待并给出超时提示。

**后果**：
- 更新期间 API 短暂 503（通常几秒，最长一次更新时长），静态单文件不受影响。
- API 每次请求多一次连接开销（本地约 10–30ms），可接受。
- 升级后必须重启一次旧进程，否则旧连接仍会占锁。
