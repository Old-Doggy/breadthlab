# BreadthLab 发布前修复报告

> **第一阶段历史记录，已由 [最终交付报告](release_completion_report.md) 更新。** 下文“未改前端”“未联网”“未修真实历史”及 NO-GO 是当时授权边界内的结论，不代表第二阶段交付状态。

日期：2026-11-12。分支：`codex/release-audit-fixes`。修复基线：`d3127b83500d2aacdf71dcbbf18e3b4bb07e7442`。

交付状态：修改保存在本地工作区，未提交、未推送。Git提交因本机未配置作者身份而拒绝；本轮未修改Git身份配置。

**总裁决：NO-GO。** 本轮后端、计算和发布链修复已通过隔离回归，但前端仍有确定的错数路径，真实历史库尚未回补重算，不能宣称全站数字可信或直接发布。

本报告是修复交付记录，不是原“53项数据审计通过”的重新认证。下列行号指本分支修复后的源码，后续编辑可能移动。

## 1. 授权范围与实际执行边界

- 修改计算层、数据管道、API、离线导出器、Windows更新入口、CI、依赖和文档。
- `frontend/` 下没有文件修改。前端只作静态阅读，没有启动浏览器或运行前端构建。
- 没有读取真实 `.env`、token、私钥或生产 `data/`，没有访问真实 DuckDB/SQLite，也没有调用行情服务。
- 测试在临时目录生成6只股票、30个交易日、3个行业和4个指数。导入项目之前设置 `BREADTHLAB_LOAD_ENV=0`，数据目录指向临时位置，Tushare token置空；测试阻断网络连接。见 [tests/conftest.py](../tests/conftest.py)。
- 没有执行真实更新、真实建库、真实导出、计划任务注册、发布或远程推送。现有行情库和已生成HTML没有被更新。

## 2. 修复清单

这里的“已修复”表示代码路径已更正；不表示真实旧数据已经修复。原审计中涉及多个层面的问题按下表拆开结案，避免把后端修复算成前端修复。

| ID | 原严重性/类别 | 状态 | 问题及本次最小修复 | 代码证据 | 验证与限度 |
|---|---|---|---|---|---|
| R01 | High / BUG | 已修复 | 按已加载行数把老股误当新股。改按上市日期与市场日历计算前5个交易日，历史观察数只用于MA窗口 | `pipeline/build_marts.py:44` | 老股仅一条历史仍可入池；IPO第4日仍剔除；缺上市日期由第14门禁阻断 |
| R02 | High / BUG | 已修复 | 非有限收益、零价格、无效因子进入计算。有效池要求收益有限且>-1，价格、因子、复权价正且有限 | `pipeline/build_marts.py:44`; `pipeline/quality_gates.py:19` | NULL、0、NaN回归均执行 |
| R03 | High / BUG | 已修复 | 个股停牌/缺日后沿用上一条记录的市值和连板。权重改取上一市场交易日，缺权重退出CW；缺交易日打断连板 | `pipeline/build_marts.py:44` | 缺前日权重、缺日连板、中断后的首板均验证 |
| R04 | High / BUG | 已修复 | 缺全部限价被算成0家涨跌停。改为空值；涨跌停覆盖加入阻断门禁 | `pipeline/build_marts.py:120`; `pipeline/quality_gates.py:36` | 全缺限价返回NULL，门禁11阻断 |
| R05 | Medium / 文档/字段语义 | 部分修复 | 当前名称不能推出历史ST。新增5%/非5%明确字段，旧ST字段只保留兼容别名并注明代理含义 | `pipeline/build_marts.py:120`; `docs/metric_contracts.md` | 未取得历史ST身份；前端旧标签仍需改 |
| R06 | High / BUG | 已修复 | 资金流和市场主池不一致。资金流仅汇总同日有效且非新股主池中有记录的股票 | `pipeline/build_marts.py:120` | 北交所异常大额记录不影响市场流量；万元转元核对 |
| R07 | High / BUG | 已修复 | 月指数缺日被默认平盘。缺任一日则该月累计为空；行业ret20要求20条完整观察 | `pipeline/build_marts.py:302`; `pipeline/build_marts.py:350` | 月内删除指数一天即NULL；真实全历史完整性未检查 |
| R08 | High / BUG | 已修复 | 当天无报价导致持仓消失。保留每股最后报价与持仓，增加quote_date/is_stale，停牌身份保持NULL | `pipeline/build_marts.py:384`; `backend/main.py:577` | 缺当日报价仍保留股份和成本；前端未显示旧报价提示，尚未闭环 |
| R09 | High / BUG | 已修复 | 当前PE负值/缺失时取历史最后一个正PE冒充当前值。API与导出都先检查最新观察，再决定分位是否可用 | `backend/main.py` 的 `valuation`; `pipeline/export_static.py:37` | 最新PE=-5和NULL均不复用旧正值 |
| R10 | High / BUG | 已修复 | API个股序列缺OHLCV字段。返回真实open/high/low/close/vol | `backend/main.py:539` | 合成K线逐字段核对；图表端渲染未运行 |
| R11 | High / BUG | 已修复 | 重跑不能更正已存在行情、指数和补充事实。按键更新/替换；拒绝重复键和错日期；指数修订用单条MERGE | `pipeline/update_daily.py` 的 `insert`、`update_indices` | 两次写同日不增行且能修正收盘价；事务外指数回补也原子更正 |
| R12 | High / BUG | 已修复 | 只按行情最大日期跳过旧缺口、失败日和T+1数据。增加逐数据集检查点、近20日重查、降级日主源重试及可选表独立补漏 | `pipeline/update_daily.py` 的 `_checkpoint_schema`、`_run` | 门禁失败回滚后同日重试通过；真实权限和历史调用量未验证 |
| R13 | High / BUG | 已修复 | 日历只续尾、不修缺口；应急更新缺本地新日历。刷新既有区间，主源替换事务化，应急模式写入已确认的交易日序列 | `pipeline/update_daily.py:59`; `pipeline/sources/akshare_fallback.py:53` | 非法日期替换保留旧日历；应急新日的pretrade_date验证 |
| R14 | High / BUG | 已修复 | 核心接口失败或门禁失败后仍留部分新日数据。日写入与门禁在同一事务，失败回滚、非零退出并记录重试意图 | `pipeline/update_daily.py` 的 `_run`; `pipeline/bootstrap_api.py` 的 `_run` | 必需行情缺失、失败后重试、门禁阻断均有回归；旧核心数据不能冒充本次请求成功 |
| R15 | High / BUG | 已修复 | 元数据刷新部分失败仍替换全表。L/D/P任一异常即中断；上市池空响应也拒绝替换；API建库统一使用VARCHAR元数据 | `pipeline/refresh_meta.py:47`; `pipeline/bootstrap_api.py:66`; `pipeline/bootstrap.py` | 上市池空响应保留旧表；实际三类账户权限未验证 |
| R16 | High / BUG | 已修复 | 备用源301板块被当10%，动态PE冒充TTM，自由流通换手用普通换手替代。301按20%；不等价字段留空 | `pipeline/sources/akshare_fallback.py:26`、`:96` | 301及ST301均20%，动态PE不进入TTM；真实上游字段仍需确认 |
| R17 | High / 风险 | 已缓解 | 快照可能在盘中/节假日被当日线。仅允许中国时间当天15:10后、确认交易日；过滤零成交快照，日历失败不猜工作日 | `pipeline/sources/akshare_fallback.py:42`、`:65` | 没有证明上游分页快照自身带有可靠成交日期；仍列UNVERIFIABLE |
| R18 | High / BUG | 已修复 | 默认事件请求只拿单一类型，炸板分母缺事件。明确分别请求U/D/Z | `pipeline/update_daily.py` 的 `fetch` | 真实接口权限/返回语义未联网验证；缺数据保持warning/NULL |
| R19 | High / BUG | 已修复 | 全链不同入口和旧锁过期判断导致并发误成功。新增OS文件锁，统一release入口覆盖拉取、验质、重建、导出 | `pipeline/locking.py:19`; `pipeline/release.py:12`; `backend/main.py:290` | 实际子进程持锁冲突、嵌套锁、释放后可取锁均验证 |
| R20 | High / BUG | 已修复 | 门禁失败仍构建、导出失败清告警。完整链成功才清；失败保留旧HTML，受控错误写告警；被拒的第二更新不覆盖活动任务告警 | `pipeline/release.py:12`; `backend/main.py:290`; `pipeline/export_static.py:367` | update/quality/export三个失败阶段与成功清告警顺序逐一验证 |
| R21 | High / BUG | 已修复 | 重建一半留下混合代际分析表。全部marts放一个事务 | `pipeline/build_marts.py:413` | 故意让第二步失败，第一步表替换回滚 |
| R22 | High / BUG | 已修复 | 静态文件直接写导致截断；资源缺失静默忽略。HTML临时写完原子替换，缺JS/CSS/字体/图标失败保留旧HTML | `pipeline/io_utils.py:10`; `pipeline/export_static.py:310`、`:367` | 缺资源、门禁失败旧HTML不变；只验证合成资源，真实产物未构建 |
| R23 | High / BUG/泄露 | 已修复一部分 | 内联JSON能用script闭合逃逸。转义小于号/U+2028/U+2029，禁止NaN；HTTP内部异常不回传路径 | `pipeline/export_static.py:357`; `backend/main.py:113` | 恶意script字符串及异常路径不泄露回归通过；ECharts HTML tooltip仍未改 |
| R24 | Medium / BUG | 已修复 | 非法日期/limit/持仓数值变500或允许NaN/负值。统一参数校验、400/404/500/503分级；SQLite异常路径释放；持仓允许清零 | `backend/main.py:50`、`:89`、`:150`、`:608` | 非法日期、反向区间、负值、Infinity、NaN、清零均验证 |
| R25 | High / 风险 | 已缓解 | 本地写接口可被不可信Host/Origin触发。限制loopback客户端和Host/Origin，更新保留自定义头，固定子进程参数 | `backend/main.py:50`、`:325` | 恶意Host/Origin/null Origin拒绝；不是用户身份认证，不应开放到外网 |
| R26 | Medium / BUG | 已修复 | 元信息硬编码源/股票数/成功，bootstrap可选接口失败仍报来自Tushare。记录实际来源、warning、生成时间；未知状态不冒充ok | `backend/main.py:358`; `pipeline/export_static.py:37`; `pipeline/bootstrap_api.py` | 可选moneyflow失败来源为unavailable；最新股票数来自n_valid |
| R27 | High / BUG | 已修复 | 重建可清除未解决的拉取失败。仅明确marts/export失败且当前门禁通过、无未完成核心检查点才允许重建恢复 | `pipeline/release.py:12`; `pipeline/refresh_status.py:14` | update/quality/未知失败阶段都不能靠rebuild变成功 |
| R28 | Medium / 安装/供应链 | 部分修复 | Node版本低于构建要求、直接依赖漂移、CI只build。README/CI改Node22，直接Python依赖精确固定，CI运行check | `.github/workflows/ci.yml`; `requirements.txt`; `pyproject.toml` | 本机Python3.12环境测试；未做全新安装、远程CI或依赖漏洞数据库核验；无传递依赖哈希锁 |
| R29 | High / 验证缺口 | 已修复 | 无本地行情时关键测试skip。改为合成数据库驱动，增加数值/失败/并发回归 | `tests/conftest.py`; 四个新增回归文件 | 本轮113项执行，0失败、0跳过；不能替代真实行情校验 |
| R30 | Medium / BUG/审计误报 | 已修复相关检查 | 自比较/内连接漏缺行、月份从中途起算、容差文案不符、审计固定历史日。改键集合/全连接、完整月、0.05pp一致，默认最新日，缺当日事件明确skip | `scripts/audit_all.py` 的 `audit_market`、`audit_integrity`、`main` | 独立派生审计在合成库通过，删一行快照后确实检出；全量跨源审计未执行 |
| R31 | Medium / 安装/脚本 | 部分修复 | Windows更新入口解释器不一致。共用解释器选择和release，失败保留旧HTML；简报失败单独警告 | `scripts/python.ps1`; `scripts/update.ps1`; `scripts/rebuild.ps1` | 所有PowerShell脚本仅解析通过；计划任务/浏览器打印未执行，触发时间使用本机时区 |
| R32 | Medium / 文档 | 已修复关键声明 | 9门禁/接口默认参数/快照目录/失败行为/全站唯一口径与代码冲突。更新中英README、技术说明、指标、数据源和建库文档，旧审计与发布记录加历史标识 | `docs/metric_contracts.md`; `docs/technical.md`; `docs/decisions/ADR-11-release-integrity.md` | 原“53通过”保留为历史记录，不作为本轮结论 |

## 3. 指标复核结论

| 指标 | 修复后真实定义与边界 | 证据 |
|---|---|---|
| breadth | 有效且非前5交易日新股池，涨/(涨+跌)；ST包含，平盘退出分母，全平盘NULL | `pipeline/build_marts.py:44`、`:120` |
| EW / CSD / IQR / q10/q90 | 同一有效且非新股池；EW为pct_chg/100算术平均，平盘参与；CSD为样本标准差，分位连续插值 | `pipeline/build_marts.py:120` |
| CW | 当日有效收益样本中，仅使用上一市场交易日正且有限流通市值，再归一；缺权重者仍可在EW池中 | `pipeline/build_marts.py:44`、`:120` |
| HHI / Top10 | HHI=Σw²×10000；Top10按权重排序，贡献=Σwr×100pp，波动占比=ΣTop10绝对贡献/Σ全部绝对贡献。贡献榜另按绝对贡献排序，不能混为一谈 | `pipeline/build_marts.py:120`; `backend/main.py:426` |
| 涨跌停 / 连板 | 成熟样本使用正有限限价，阈值0.999/1.001；缺限价未知；市场缺日打断连续涨停；首板1，连板>=2 | `pipeline/build_marts.py:44`、`:120` |
| 成交额 / 市值 / 流量 / 两融 | daily.amount千元→元×1000；circ_mv/total_mv保留万元供权重及个股使用；moneyflow万元→元×10000；margin原始元不乘10000 | `pipeline/build_marts.py:120`、`:384`; `pipeline/sources/akshare_fallback.py:76`、`:96` |
| 指数 | core_index_day中四指数pct_chg/100；收益一致性门禁13，缺指数为warning，不拿CW冒充指数 | `pipeline/build_marts.py:120`; `pipeline/quality_gates.py:36` |
| 月度 / 区间 | 月表ew_ret/cw_ret为日均值，ew_ret_cum是每日EW复利；区间前端另有计算，不在本轮宣称正确 | `pipeline/build_marts.py:350`、`:370`; `frontend/src/lib/api.ts:275` |
| 静态与API | 核心数值来自同一mart；导出增加真实月表与coverage，但静态前端仍自己monthAgg、部分查询只支持最新日 | `pipeline/export_static.py:37`; `frontend/src/lib/api.ts:275` |

独立6股例：上涨3、下跌2、平盘1，breadth=3/5，EW=0.005/6，CW=0.0006，成交额60,000,000元；通过改变当日市值证明CW不受当日权重污染。见 `tests/test_release_regressions.py:14`、`:32`。

## 4. 仍存在的问题：必须涉及前端，按本次边界未修改

| 严重性 | 仍存在的问题 | 证据及最小后续处理 |
|---|---|---|
| High | 英文金额B/K数量级错误，例如1亿元被标成1B；K也以1万作除数 | `frontend/src/lib/format.ts:31`；按国际B=1e9、K=1e3修正并验证边界 |
| High | 持仓当日盈亏按当日市值×收益，组合收益按期末权重，造成系统性偏差 | `frontend/src/pages/Watchlist.tsx:54`；使用期初价格/权重，处理分红和交易假设 |
| High | 沪深300缺失回退CW仍标沪深300；固定文字会把相反行情也解释为权重拖累 | `frontend/src/pages/Today.tsx:109`、`:162`；指数缺失显示未知，结论由实际数据条件驱动 |
| High | 静态日期不存在退到最新日、历史分布缺失返回0统计；新增后端月表尚未被前端使用 | `frontend/src/lib/api.ts:275`、`:344`；静态查询明确覆盖与缺失，月频消费market_monthly |
| High | 简报炸板率用含ST价格涨停作分母，与官方事件分母冲突；来源仍硬编码Tushare | `frontend/src/pages/Briefing.tsx:42`、`:54`；直接显示broken_rate与真实来源 |
| High | 空市场数组仍被当成正常数据访问；部分页面失败后一直骨架屏；新NULL字段也未端到端适配 | `frontend/src/pages/Market.tsx:63`; `frontend/src/pages/Briefing.tsx:34`; `frontend/src/lib/api.ts:39`；明确空、失败、未知状态 |
| High / 安全风险 | 多个ECharts HTML tooltip直接插入上游名称，内联JSON安全修复不能解决tooltip阶段注入 | `frontend/src/lib/charts2.ts:82`；对进入HTML的动态字段做HTML转义，验证恶意名称只显示文本 |
| Medium | 行业个股只取前400条，尾部跌幅列表因此可能漏真正最差股 | `frontend/src/pages/Sectors.tsx:118`；在全量样本排序后取头尾 |
| Medium | 月度卡片/实验图仍有月收益、累计收益、日均收益混用；分布分箱、截尾和坐标标签仍有原审计问题 | `frontend/src/components/MonthlyGrid.tsx`; `frontend/src/pages/Sectors.tsx:79`; `frontend/src/pages/ChartLab.tsx`; `frontend/src/lib/charts.ts`；需逐图修复并用固定例子验算 |
| Medium | CSV仅逗号拆分；本地持仓与SQLite两条路径校验、更新语义不同 | `frontend/src/pages/Watchlist.tsx:117`; `frontend/src/lib/api.ts:316`；需定义统一CSV和持仓契约 |
| Medium | 旧报价提示未展示；7天滞后阈值过宽，简报告警和失败后的缓存刷新仍需处理；i18n有硬编码 | `frontend/src/components/Shell.tsx:149`; `frontend/src/components/UpdateControl.tsx`; `frontend/src/components/StatusBar.tsx`；接入quote_date/is_stale和统一错误状态 |

这些问题仍可能让用户看到错数字。后端测试通过不能覆盖或豁免上述阻断项。

## 5. UNVERIFIABLE 与保留的设计限制

| 项目 | 缺什么条件 / 尚不能证明什么 |
|---|---|
| 真实历史数字、回补效果、门禁阈值误报率 | 需在由所有者操作的数据库副本中，按日检查历史，回补降级/缺失日期，重新构建后与独立源对账。本轮没有读取或修正真实历史库 |
| Tushare建库、配额、U/D/Z事件权限、可选数据完整性 | 需账户所有者实际演练；不需要把token交给审计方。bootstrap默认20240101，约13请求/交易日，不能承诺1–2秒完成 |
| akshare实际快照日期、分页一致性与字段单位 | 需收盘后实际响应及上游时间证明。当天/交易日/15:10限制不能证明分页行情没有缓存或跨时点 |
| ST历史、重新上市、特殊无涨跌停日 | 缺历史证券状态及交易所特殊事件。5%代理不是ST身份；备用计算限价不是交易所权威限价 |
| 复权因子顺延 | 有意应急降级，除权期间可持续失真；恢复主源后需回补。不能承诺“只偏一天” |
| 行业PIT、存活偏差 | 当前行业映射仍是静态元数据，不是历史时点成员。需要PIT行业与退市历史数据；本轮没有制造一套伪PIT |
| 新机安装与供应链 | 直接依赖已精确固定，但未在干净机器重装、未查询实时漏洞库，传递依赖与GitHub Actions标签没有哈希级冻结 |
| Linux CI、真实前端构建和浏览器file:// | 本机只执行Python测试及脚本解析；CI配置增加check不等于远程CI已绿。真实字体、图标、浏览器兼容及单文件体积需构建产物验收 |
| Windows调度/简报 | 未注册或触发任务。17:35/02:00使用本机时区，工作日不等于交易日；节假日可重查近期数据。简报内容仍有上述前端问题 |
| 跨产物一致性 | 数据库、JSON、HTML分别提交/原子替换，不能跨文件同时切换；API可能读到上一个完整mart。HTML失败保留旧文件，已分发离线文件不能收到未来告警 |
| 历史仓库隐私 | 本轮不读取私密文件，也没有重写Git历史。先前静态扫描不能证明历史所有二进制/删除文件都不存在秘密；公开历史本机路径不能靠工作区修复抹除 |

发布锁覆盖本轮标准入口；独立手工SQL和不使用release的其他工具不能因此获得全链发布保证。`export_static --allow-failed`保留为显式诊断出口，不能用于正式发布绕过门禁。

## 6. 实际验证记录

| 检查 | 实际结果 |
|---|---|
| Python隔离回归 | **113 passed，0 failed，0 skipped**；Python3.12.16，DuckDB2.0.0；最后一轮8.03秒 |
| Python检查 | `python -m ruff check .` 通过；规则为项目配置的语法/未定义名检查，不代表全面安全扫描 |
| Windows脚本 | `scripts/*.ps1` 全部只做PowerShell语法解析，通过；没有执行脚本动作 |
| 差异检查 | `git diff --check` 通过；仅有Git行尾格式提示 |
| 前端边界 | `git diff -- frontend` 为空 |
| 真实数据审计 | 未执行，不引用旧53项通过数作为当前结果 |

有意义的新回归包括：独立6股手算、CW前日权重、全平盘分母、IPO年龄、停牌缺日、无效PE、301限幅、缺限价、月指数缺日、资金流池、写入幂等、核心失败回滚重试、真实子进程锁、marts全事务、发布三阶段失败、清告警顺序、JSON注入、缺资源保留旧HTML、API非法参数与异常脱敏、审计漏行检测。对应 `tests/test_release_regressions.py`、`tests/test_metric_safety.py`、`tests/test_api_export_fixes.py`、`tests/test_publication_safety.py`。

## 7. 发布前必须完成的5件事

1. 修复英文金额、持仓收益、假沪深300回退、静态查询与月频等前端High错数项，并适配NULL/旧报价状态。
2. 由所有者在真实数据库副本上回补主源缺口、降级日期及迟到数据，按本次口径重建；先前错误marts不会自动因改源码而变化。
3. 对重建结果逐日审计，再进行独立源抽样；确认历史行业偏差、IPO/特殊限价和因子顺延的范围，不把warning当完全通过。
4. 干净环境重装、运行远程CI，完成API和file://端到端验收，包含503/空数据/失败告警/字体图标/CSV/中英文数量级。
5. 在副本上演练一次完整失败及恢复：门禁失败不得发布，导出失败不得清告警，并发第二任务不得报成功；核验Windows账户、解释器和调度时区，再决定正式切换。

拟采用的标准入口是 `python -m pipeline.release`；仅重算发布用 `python -m pipeline.release --rebuild`。这些命令本轮**没有对真实数据执行**。rebuild不能修复缺失的原始行情，也不能把未解决的拉取失败改成成功。

## 8. 最容易忽略但影响最大的3点

1. **正确的公式仍会被错误的时间键污染。** 前一条股票记录不等于前一市场交易日；这同时影响CW、连板、IPO年龄，缺一条日历就可能整批错数。
2. **改代码不等于改历史数字。** 旧core修订、降级因子和静态HTML需要回补、重建、重新分发；已经发送的HTML永远不会自动知道下一次更新失败。
3. **相似字段不能互相兜底。** CW不是沪深300，动态PE不是TTM，5%限制不是ST身份，缺报价不是停牌，月均收益不是月累计；本轮只修了允许范围内的路径。

## 9. 实际阅读和修改的文件

完整阅读或逐段审阅本轮相关内容的文件如下；目录本身不是“已阅读”证明，未声称遍历整个Git历史或所有前端图表实现。

- 文档：`README.md`、`README.en.md`、`docs/technical.md`、`docs/technical.en.md`、`docs/metric_contracts.md`、`docs/data_sources.md`、`docs/data_setup.md`、`docs/audit_findings.md`、`docs/audit_report.md`、`docs/decisions.md`、`docs/status.md`、`docs/release.md`、`docs/decisions/ADR-11-release-integrity.md`。
- 计算与管道：`pipeline/build_marts.py`、`pipeline/update_daily.py`、`pipeline/bootstrap.py`、`pipeline/bootstrap_api.py`、`pipeline/quality_gates.py`、`pipeline/settings.py`、`pipeline/db.py`、`pipeline/refresh_meta.py`、`pipeline/refresh_status.py`、`pipeline/alerts.py`、`pipeline/sources/akshare_fallback.py`、`pipeline/export_static.py`、`pipeline/release.py`、`pipeline/locking.py`、`pipeline/io_utils.py`。
- API/配置/脚本：`backend/main.py`、`requirements.txt`、`pyproject.toml`、`.github/workflows/ci.yml`、`.gitignore`、`Makefile`、`scripts/update.ps1`、`scripts/rebuild.ps1`、`scripts/python.ps1`、`scripts/install_task.ps1`、`scripts/briefing.ps1`、`scripts/audit_all.py`。
- 测试：`tests/conftest.py`、`tests/test_api.py`、`tests/test_metrics.py`、`tests/test_alerts.py`、`tests/test_db_lock.py`、`tests/test_release_regressions.py`、`tests/test_metric_safety.py`、`tests/test_api_export_fixes.py`、`tests/test_publication_safety.py`。
- 前端只读复核：`frontend/src/lib/format.ts`、`frontend/src/lib/api.ts`、`frontend/src/lib/charts.ts`、`frontend/src/lib/charts2.ts`、`frontend/src/lib/charts3.ts`、`frontend/src/lib/charts4.ts`、`frontend/src/lib/charts5.ts`、`frontend/src/pages/Today.tsx`、`frontend/src/pages/Watchlist.tsx`、`frontend/src/pages/Briefing.tsx`、`frontend/src/pages/Market.tsx`、`frontend/src/pages/Sectors.tsx`、`frontend/src/pages/ChartLab.tsx`、`frontend/src/components/MonthlyGrid.tsx`、`frontend/src/components/StatusBar.tsx`、`frontend/src/components/Shell.tsx`、`frontend/src/components/UpdateControl.tsx`。
