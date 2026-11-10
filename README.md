# BreadthLab · A股市场结构终端

> 不回答“今天涨还是跌”，而是回答 **这波涨跌由谁参与、由谁推动、内部是否一致**。

BreadthLab 把指数涨跌拆成四层：**市场广度 → 集中程度 → 行业结构 → 个股分化**，
用一套统一的指标口径与深色终端风格，把“指数看不见的部分”做成可以每天打开的操作面板。

![Today](docs/screenshots/today.png)

---

## 1. 它解决什么问题

指数是加权结果：指数涨 1%，可能意味着 70% 的股票都在涨，也可能只有 3 只权重股在拉。
只看看指数，你无法回答：

- 这波行情有多少股票真正参与？
- 涨幅是不是集中在少数股票、少数行业？
- 行业平均收益背后，是个股普涨还是龙头独舞？
- 涨停潮是真的情绪修复，还是少数题材的狂欢？
- 我的持仓今天是被普涨带起来的，还是被少数股票带的？

BreadthLab 用 7 个页面把这些问题变成可交互的证据链。

---

## 2. 页面

| 页面 | 回答的问题 | 核心图 |
|---|---|---|
| **今日体检** | 今天是什么性质的一天？ | 一句话结论 + 广度温度计 + 收益×广度双联图 + 贡献榜 |
| **市场结构** | 收益与广度长期如何背离？ | 收益/广度时间序列 + 集中度 + 分化度 |
| **状态地图** | 每天落在“收益×广度”的哪个位置？ | 四象限散点 + 30 日轨迹 + 相似日 |
| **行业参与** | 哪个行业是真普涨，哪个只是龙头拉？ | 行业气泡 + 月度热力图 + 行业内领涨/领跌 |
| **个股分化** | 行业均值之下个股长什么样？ | 市值×收益散点 + 分布直方图 + 明细表 |
| **情绪极端** | 涨停潮是真的还是假的？ | 涨跌停家数 + 连板梯队 + 新高新低 + 两融 |
| **自选组合** | 我的组合被什么带动？ | 组合收益/贡献分解/上涨占比 |

'### 每日简报（PDF / PNG）

`#/briefing` 是打印优化的 A4 单页：一句话结论 + 6 个 KPI + 两张核心图 + 行业强弱 + 最大贡献个股 + 今日三条。

```powershell
pwsh -File scripts\briefing.ps1
# -> data/snapshots/YYYYMMDD/briefing.pdf / briefing.png
```

简报使用 light 主题、A4 版式，可直接贴进周报或打印。

'### 双语

界面支持中/英切换，也可用 URL 直接指定：`BreadthLab.html?lang=en#/`。
英文覆盖导航、页面文案、KPI、核心图表 tooltip 与金额单位（`¥2.90T`）；
行业名与股票名保留中文（数据本身即中文分类），这是有意的取舍。

### 移动端'

`< 768px` 自动切换为底部导航 + 单列布局，图表高度、KPI 字号、表格列宽都会收缩；已在 390×844 下逐页校对。

完整截图见 `docs/screenshots/`。'

---

## 3. 快速开始

### 方式 A：直接打开（零依赖）

双击 `frontend/dist/BreadthLab.html`。
这是一个 **单文件仪表盘**（内联 JS/CSS/字体/数据，约 14 MB），可在 `file://` 下完整交互。

### 方式 B：本机服务（可每日更新）

```powershell
# 1) 环境（已存在则跳过）
conda create -y -n breadthlab python=3.12
D:\Anaconda\envs\breadthlab\python.exe -m pip install -r requirements.txt

# 2) 配置 token
Copy-Item .env.example .env
#   编辑 .env，填入 TUSHARE_TOKEN=...

# 3) 从本地快照构建（一次性，约 1 分钟）
$py = "D:\Anaconda\envs\breadthlab\python.exe"
& $py -m pipeline.bootstrap
& $py -m pipeline.build_marts
& $py -m pipeline.export_static

# 4a) 打开单文件
start frontend\dist\BreadthLab.html

# 4b) 或起本地服务
& $py -m backend.main          # http://127.0.0.1:8000
```

### 每日自动更新

```powershell
# 手动
pwsh -File scripts\update.ps1

# 注册计划任务（周一至周五 17:35）
pwsh -File scripts\install_task.ps1
```

更新链路：`Tushare 增量 → 质量门禁 → core → mart → 单文件导出`。
任何一步失败都不会发布半成品，`data/meta/status.json` 会记录状态，页面顶部会显示数据截止日。

---

## 4. 数据与口径

### 4.1 数据源

- 主源：**Tushare Pro**（`daily`、`daily_basic`、`adj_factor`、`stk_limit`、`limit_list_d`、`moneyflow`、`index_daily`）
- 备源：**akshare**（指数缺口、交叉校验）
- 本地快照：`./data/snapshot`（按 `ts_code` 重排的 parquet，2014-01 → 2026-05-22）

### 4.2 分层

```
F:/ 快照 或 Tushare API
        │  bootstrap / update_daily（幂等、按日批量、质量门禁）
        ▼
data/raw/*.parquet            原始落地（保留上游字段）
        ▼
data/lake.duckdb               core_stock_day / core_limit_event / core_index_day ...
        ▼
                               feat_stock（复权、MA、新高、涨跌停标记）
                               mart_market_day / mart_sector_day / 月度聚合
        ▼
Flask API  ──►  React + ECharts（深/浅主题、中/英）
        └────►  export_static.py ──► 单文件 HTML
```

### 4.3 关键口径（全站唯一）

| 指标 | 定义 |
|---|---|
| 上涨占比 `breadth` | N(涨) / (N(涨)+N(跌))，剔除平盘与无有效收益 |
| 等权收益 `ew_ret` | mean(pct_chg/100)，当日有效样本 |
| 市值加权 `cw_ret` | Σ wᵢrᵢ，w 用**前一日** `circ_mv` 归一（避免同日价格内生） |
| 集中度 `hhi` | Σ wᵢ² × 10000 |
| Top10 波动占比 | Top10 权重股 \|wᵢrᵢ\| / Σ\|wᵢrᵢ\|，有界 0–1 |
| 分化度 `csd` | 横截面收益标准差（pp） |
| 涨停 | `close ≥ up_limit × 0.999`（用 `stk_limit` 真实涨跌停价，不猜 10%/20%） |
| 新高 | `adj_close ≥ 过去 252 日最高`，且历史 ≥ 250 日 |
| 行业 | Tushare 行业 → 31 个申万一级（`config/industry_bridge.csv`），覆盖率 99.9% |

行业映射是已知最脏的一环：`index_member_all` 本地为空，`bak_basic.industry` 标签会漂移。
当前采用「静态标签 + 人工桥接表」，未映射股票计入“未分类”并在 About 页标注。

---

## 5. 工程结构

```
breadthlab/
├─ pipeline/            # bootstrap / build_marts / update_daily / export_static / backfill_index
├─ backend/             # Flask API（market / sectors / stocks / watchlist / meta）
├─ frontend/            # Vite + React + TypeScript + Tailwind + ECharts
│  └─ src/{pages,components,lib}
├─ config/              # industry_bridge.csv
├─ data/                # 不入库：lake.duckdb / marts / static-data.json
├─ scripts/             # update.ps1 / dev.ps1 / install_task.ps1
├─ docs/                # 口径、审计、截图
└─ tests/               # pytest：指标 golden values + API 契约
```

技术选择：**DuckDB**（12M 行聚合毫秒级）+ **Flask**（同步、零异步依赖、Windows 稳定）+
**React/ECharts**（交互与视觉上限）+ **单文件导出**（可直接分享/离线打开）。

---

## 6. 已知限制

- 本地快照止于 **2026-05-22**；之后需用 Tushare token 增量补齐（指数已用 akshare 补到最新）。
- 北向资金 2024-08-19 后口径断裂（净买入 → 成交额），**不做跨期时间序列**。
- 行业分类为静态映射，历史行业归属存在前视偏差；停牌/新股首日已按规则剔除。
- 全部为**描述性分析**，不构成预测或投资建议。

---

## 7. Roadmap

- [x] 每日简报自动生成 PDF/PNG（无头 Edge）
- [ ] 行业映射升级为申万 PIT 成员（`index_member_all`）
- [ ] 自选组合的持仓成本/盈亏与 Brinson 简化归因
- [ ] 数据质量看板（最近 30 天门禁结果、源间对账）
- [x] 移动端布局（底部导航 + 单列）
