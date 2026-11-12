# 2026-11-12 验收证据

这些文件仅记录隔离数据库副本的检查摘要，不包含凭据、个人持仓或行情明细。代码基线、修改范围与限制见 [最终交付报告](../release_completion_report.md)。

- `checks.json`：安装、回归、构建与漏洞扫描摘要。
- `browser-acceptance.json`：API和断网file模式20个路由检查、主题/色盲/英文、虚构持仓与API/静态逐字段对比。
- `repair-run.json`：最近20日实际更新的来源、告警与耗时。
- `repair-summary.json`：192个明显部分日期修复后剩余检测及行数。
- `full-history-audit.json`：全历史覆盖指标的差异计数；0代表未检出差异，不是全历史真值证明。
- `independent-audit.json`：最新日37项派生核对。
- `reconcile.json`：独立源返回无重合记录，不能算通过。

逐日修复记录在交付副本的 `meta/history_repair.json`。首轮已修11日后网络中断，续跑修复181日，因此该次运行明细不单独代表192日总数；总修复量由前后行数、操作记录与最终剩余计划共同确定。
