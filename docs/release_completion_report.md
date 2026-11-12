# BreadthLab 修复与真实副本验收报告

日期：2026-11-12（上海时间）。基线：`d3127b83500d2aacdf71dcbbf18e3b4bb07e7442`；分支：`codex/release-audit-fixes`。源码与文档随本次提交进入仓库；数据副本与候选 HTML 不入库。第一阶段记录见 [release_fix_report.md](release_fix_report.md)，其“未修改前端/未联网/未修历史”已经被本报告更新。

## 总裁决

**GO with caveats：可作为注明数据限制的本地候选版本验收；不能宣称全历史、全数据源已经完全认证。** 确定的前后端错数路径已修正，真实数据库副本完成回补与重算，测试及实际浏览器验收通过；事件权限、时点行业/ST身份及独立源核验仍有限制。原库与原发布文件没有替换。

## 交付位置与隐私边界

- 修复后的数据库副本：`<验收副本>/lake.duckdb`，3,709,874,176 bytes。
- 可双击的候选离线包：`<验收副本>/web/BreadthLab.html`，约60.8 MB。
- 机器可读验收证据：[validation/](validation/)，完整操作和回补记录在副本的 `meta/`。
- 原 `data/lake.duckdb` 仍为3,374,854,144 bytes、2026-11-11写入；原 `frontend/dist/BreadthLab.html` 仍为35,457,645 bytes、2026-11-11写入。实际回补、重算、导出均指向隔离目录，再保留到上述稳定交付目录。
- 现有凭据只由程序加载以调用获授权的数据源；没有查看、打印或复制 `.env`、token、密钥。Tushare客户端改为内存传参，移除会在用户目录持久化凭据的 `set_token` 调用。没有复制个人SQLite持仓或个人浏览器资料；浏览器使用临时配置与虚构持仓。
- 没有将修复副本接管为默认生产库；没有注册计划任务或上传行情、HTML到远程。

## 修复清单

下列证据指当前工作区；更详细的第一阶段32项见历史报告。这里的修复包含行为更正，不保证上游本身无错误。

| ID | 严重级别/类别 | 问题与修复 | 代码证据 | 如何验证/实际结果 |
|---|---|---|---|---|
| C01 | High / BUG | “日期存在”掩盖整日部分股票缺失；新增副本历史修复器，按21日局部中位数识别低于85%的日期，四类核心数据齐备才事务替换，失败重试与回滚 | `pipeline/repair_history.py:20`、`:31`、`:37` | 实际修复192日；净增536,498行；检测器剩余异常日期为空；这是启发式，不能检出所有零散漏股 |
| C02 | High / BUG | IPO年龄误用已加载行数；权重误用个股上一条记录；缺日连板不中断 | `pipeline/build_marts.py:44` | 按上市日期及市场日历；CW用上一市场交易日市值；缺交易日打断连板；真实重建完成 |
| C03 | High / BUG | 缺限价误报0家，历史ST代理被当真ST | `pipeline/build_marts.py:240` | 缺限价保持NULL；旧ST字段返回NULL；新增明确5%/非5%字段，页面标签同步 |
| C04 | High / BUG | 日写入、元数据与分析表半更新；并发/导出失败误成功 | `pipeline/release.py:12`、`pipeline/locking.py:19`、`pipeline/build_marts.py:414` | OS锁覆盖完整发布；日事务及marts事务；失败不清告警/不覆盖旧HTML；121项回归含失败及并发路径 |
| C05 | High / BUG | 质量门禁把特殊无价格限制退市日当异常收益；大库IPO日历相关子查询过慢 | `pipeline/quality_gates.py:18`、`:47` | 2026-10-23实际002731.SZ下跌59.7403%，权威限价为999999.999/0.01；仅此类权威无限价标记豁免，普通异常仍阻断；最近日门禁约1.1秒 |
| C06 | High / BUG | API缺真实OHLCV/错误泄露内部信息/Windows写锁被当500 | `backend/main.py:115`、`:134`、`:152`、`:539` | 返回真实K线；通用错误；Windows“File is already open in”识别为503；请求退出释放连接 |
| C07 | High / BUG | 静态月频自行重算，与API不一致；缺日期悄悄用最新数据 | `frontend/src/lib/api.ts:329`、`:337`、`:386` | 静态直接取导出的月表，未覆盖的明细明确失败；2414日和120月的API/静态字段逐项比对，允许导出6位小数舍入 |
| C08 | High / BUG | 持仓日收益按期末权重计算、漏股/旧报价当正常、CSV部分非法写入 | `frontend/src/lib/holdings.ts:14`、`:29`、`:37`；`frontend/src/pages/Watchlist.tsx:50` | 今日盈亏=shares×(close−pre_close)，分母为期初市值；缺报价保留持仓，今日收益未知；CSV先整体解析校验；实际断网持仓页面与两个图表通过 |
| C09 | High / BUG | 英文B/K金额数量级错误、非有限数误展示 | `frontend/src/lib/format.ts:28` | T/B/M/K换算，非有限值未知；数值回归覆盖10亿与1000 |
| C10 | High / BUG | 指数缺失拿CW或0兜底，简报作无证据因果归因 | `frontend/src/lib/regime.ts`；`frontend/src/lib/viewMetrics.ts`；`frontend/src/pages/Today.tsx`、`Briefing.tsx` | 缺指数明确未知；文案仅描述已观测数据；官方炸板率不与价格涨停混用 |
| C11 | High / BUG | 分箱偏移、象限标签倒置、散点随机偏移跨分类边界 | `frontend/src/lib/charts.ts:220`、`:340`；`frontend/src/lib/charts2.ts:229` | 0基分箱；±11%范围外数量明示；象限匹配真实x/y；散点不随机移位 |
| C12 | Medium / BUG | 集中度纵轴截去20%以上；缺收益补0；月累计把日均值当月收益 | `frontend/src/lib/charts2.ts:146`；`frontend/src/lib/charts3.ts:236`；`frontend/src/components/MonthlyGrid.tsx` | 纵轴0–100%；缺值留缺口；用月累计字段复利，遇缺月后保持未知 |
| C13 | High / BUG/安全 | tooltip插入未转义名称，负贡献符号丢失 | `frontend/src/lib/html.ts`；`frontend/src/lib/charts5.ts:89`；`frontend/src/pages/Stocks.tsx` | 恶意名称formatter验证；负贡献保留负号；9类图表实际ECharts SVG渲染 |
| C14 | Medium / BUG | 空数据/503持续骨架；可选源失败但状态栏全绿 | `frontend/src/components/DataState.tsx`；`StatusBar.tsx`；`frontend/src/lib/viewMetrics.ts:2` | 区分加载、空数据、错误；源warning和门禁warning均提示告警；真实Windows锁返回503，浏览器显示重试提示 |
| C15 | High / BUG | 新版真实字体woff未内联；Vite模板字面量图标路径遗漏 | `pipeline/export_static.py:312`、`:336` | 真实构建先复现导出失败/离线图标丢失，再支持woff/woff2与三种JS引号；断网file页面无外部请求或缺资源 |
| C16 | High / 供应链 | 已知Vite/ECharts/router漏洞及升级类型不兼容 | `frontend/package.json`、`package-lock.json`、`frontend/src/main.tsx` | 固定ECharts6.1.0、Router7.18.5、Vite8.3.8、React插件5.2.0；移除旧Router属性；官方npm审计0已知漏洞 |
| C17 | Medium / 验证/安装 | 关键测试依赖本地数据或被跳过，CI只构建 | `tests/conftest.py`；`frontend/tests/`；`.github/workflows/ci.yml`；`frontend/package.json` | 无行情/无凭据/禁网络合成回归121通过0跳过；前端32通过；CI的check含类型、回归和构建；Node要求22.18+ |
| C18 | Medium / 文档 | 旧53通过、9门禁、页面数、导出体积、阶段性结论与当前状态混淆 | README中英文、指标/数据源/建库/技术/ADR、历史报告页首 | 明确14门禁、8主页面加2附加页、约60.8MB；历史审计保留历史标记，当前结论统一到本报告 |

## 真实数据修复与验证

1. 原副本core日线为10,229,769行，日期2016-12-01至2026-11-11。无整日缺失不等于数据完整：实测2018-01-30仅219行，主源返回3291行。
2. 检出192个明显部分日期，分布2016–2022。四类核心数据回补完成，core为10,766,267行，净增536,498行。某次网络中断后重跑只处理剩余日期，已提交日期保留。历史修复保守要求正且有限核心字段覆盖至少95%，当日14门禁阈值没有放宽。[修复摘要](validation/repair-summary.json)
3. 最近20个交易日实际重查完成，141.5秒；core、资金流、两融、指数来自Tushare，事件不可用，32条warning保留。[实际更新摘要](validation/repair-run.json)
4. 全量重建：feat10,421,172行；市场2414日；行业74,834行；市场月120行、行业月3720行；最新持仓报价5475只。最差单日有效样本前日权重覆盖约99.04%，不再由历史部分日期造成大幅缺权重。
5. 最新日14门禁全部通过；独立最新日37项比较0失败。[最新日复核](validation/independent-audit.json)
6. 全历史逐日复核主键重复、市场样本数、EW、breadth、CW，以及每月EW复利，差异计数均0。[全历史复核](validation/full-history-audit.json) 这是针对覆盖指标的派生一致性检查，不是逐笔交易所真值认证；全历史每个日期的14条门禁没有逐日完整重跑。

## 安装与界面验收证据

| 项目 | 实际结果 | 限制 |
|---|---|---|
| 干净Python环境 | Python3.12.16，按requirements精确安装；121通过、0失败、0跳过；ruff通过；pip check无破损依赖 | 本机Windows；不等于所有Python版本/平台 |
| 干净前端目录 | npm ci安装127包；类型检查、32项Node回归、生产构建通过 | Node24.15实际运行；CI配置Node22，远程CI未触发 |
| 依赖漏洞库 | pip-audit对requirements无已知漏洞；官方registry.npmjs.org的npm audit为0 | 默认npm镜像不支持审计接口，明确切换官方地址完成；扫描时间点2026-11-12，不保证未来/未知漏洞 |
| API模式 | 实际Edge逐页检查10路由，无JS/控制台错误、无NaN/Infinity、无数据错误面板 | 有数据副本、loopback服务；外网多用户部署不在范围 |
| file离线模式 | 真实约60.8MB HTML，浏览器网络设为offline后10路由成功，字体图标正常，无HTTP请求；临时持仓能显示及绘制两个图表 | 文件的localStorage依赖浏览器及文件路径，不能作为跨文件可靠持仓存储 |
| API/静态一致性 | 2414日、120月逐字段比较差异0（数值容差0.0000011） | 静态是覆盖受限的快照；不承诺所有历史明细均随包分发 |
| 外观 | 英文、light主题、蓝橙色盲模式通过；保留页面布局，修正数值/轴/标签必然改变部分图形 | 不是所有屏幕、语言文案逐字截图比对；允许少量未翻译术语 |

浏览器完整记录见 [browser-acceptance.json](validation/browser-acceptance.json)。复跑脚本：[frontend/scripts/verify_release.mjs](../frontend/scripts/verify_release.mjs)，只接收loopback URL及显式副本目录；Windows Edge、临时浏览器配置。

## 尚未解决或无法证明的事项

| 项目 | 分类/影响 | 当前证据与所需条件 |
|---|---|---|
| 事件接口权限 | 已确认的数据源限制 | 现有账户limit_list_d不可用；价格涨跌停与连板可用，但官方炸板/封单等不能补造。需合法事件权限或同口径历史源 |
| 三个历史代码 | 已确认覆盖限制 | 000022.SZ、000043.SZ、300114.SZ，共3056条历史行没有可靠上市日期，主源L/D/P和定向查询没有补齐，继续排除；需要交易所/可信证券主表，不能猜日期 |
| 行业时点/历史ST | 已确认设计限制 | 目前是静态行业映射；缺历史ST身份。5%限价不是ST认证。需要带生效日期的成员与状态数据；已在About及契约说明 |
| 独立源真值确认 | UNVERIFIABLE | 实际akshare对8股×最近3日抽样无重合记录，n=0，不能得出“两源一致”。需返回目标日期的独立历史源。[原始摘要](validation/reconcile.json) |
| 更细微历史漏股、上游更正、拆并股特殊事件 | UNVERIFIABLE | 85%局部中位数检测不覆盖所有低比例缺漏；相同主源重算不能发现主源系统性错误。需逐日证券有效列表、公司行为与独立对账 |
| 备用快照真实性 | UNVERIFIABLE | 已限制当天收盘后、核验交易日并修301/PE/单位；无可靠逐股成交日期时，仍不能保证上游快照全量新鲜。离线/历史不靠快照冒充 |
| 完全空库全历史bootstrap、远程CI、计划任务触发 | UNVERIFIABLE | 已干净安装、合成库建库/恢复测试及真实副本更新；没有用账户配额再建一整套空历史库，没有远程推送或注册调度 |
| 原发布接管 | 未执行 | 按授权仅修副本。普通启动仍读取原库/原dist；候选HTML可直接打开。正式替换需要独立切换和回滚安排 |
| 完整Git历史秘密认证 | UNVERIFIABLE | 未读取秘密且未改写历史；不能据本轮工作保证所有历史二进制/已删除文件无秘密。候选数据与HTML不应误入源码提交 |

“数据源限制”已做能落地的处理：失败/缺失可见、等价字段不互相冒充、失败保留旧产物。权限和历史事实本身无法仅靠代码创造。

## 正式发布前的五个事项

1. 使用本候选包复核修正后的数值变化，再安排原库与原HTML的可回滚切换；当前原文件保留。
2. 若宣传包含官方炸板/封单全历史，先取得事件权限并回补；否则持续明确缺失范围。
3. 若宣传支持严格历史行业/ST研究，先接入时点数据及三个退市代码主表；否则保留排除及静态映射说明。
4. 独立数据源必须返回目标日期并完成比较，才能宣称跨源认证；本轮n=0不能算通过。
5. 配置合法Git作者后提交，运行远程CI及真实调度验收；本轮没有更改作者配置、注册任务或推送。

## 最可能被忽略的三个高影响点

1. 日线表有该日期仍可能只有几百只股票；这会同时污染当日广度/EW及下一交易日CW权重。只看最大日期和最新门禁会漏掉。
2. “公式一致”“页面能画”“上游正确”是三个不同证明层次；本轮前两者有实测证据，第三者仍受独立源与历史身份限制。
3. 原数据、修复副本、已经分发的离线HTML彼此独立；改代码/副本不会自动修正用户已拿到的旧包，旧包也收不到未来告警。

## 实际审阅的文件

- 文档：README中英文、technical中英文、metric_contracts、data_sources、data_setup、audit_findings、audit_report、decisions、status、release、ADR-11与第一阶段修复报告。
- Python：`pipeline/settings.py`、`db.py`、`io_utils.py`、`locking.py`、`release.py`、`repair_history.py`、`bootstrap.py`、`bootstrap_api.py`、`update_daily.py`、`build_marts.py`、`quality_gates.py`、`refresh_meta.py`、`refresh_status.py`、`alerts.py`、`export_static.py`、`reconcile_sources.py`、`sources/akshare_fallback.py`、`backend/main.py`、`scripts/audit_all.py`。
- 前端：`main.tsx`、`App.tsx`、`lib/api.ts`、`format.ts`、`holdings.ts`、`html.ts`、`viewMetrics.ts`、`regime.ts`、`theme.ts`、`charts.ts`至`charts5.ts`；Today、Market、Regime、Sectors、Stocks、Sentiment、Watchlist、About、Briefing、ChartLab全部页面；EChart、MonthlyGrid、Shell、StatusBar、UpdateControl、DataState组件；store/ui、index.css与verify_release脚本。
- 配置与测试：requirements、pyproject、package与lock、tsconfig、CI、gitignore、Makefile、Windows更新/重建/解释器/安装任务脚本；tests下合成fixture及指标、API、并发、告警、发布、历史回补回归；frontend/tests下5个文件。

本列表表示相关文件已阅读审查，不表示逐个Git历史版本或所有平台都已执行验证。
