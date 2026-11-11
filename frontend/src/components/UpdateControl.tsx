import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, CloudDownload, Loader2, X } from "lucide-react";
import { api, isStatic, type UpdateJob } from "../lib/api";

const IDLE: UpdateJob = {
  id: null,
  state: "idle",
  progress: 0,
  stage: "",
  message: "",
  started_at: null,
  finished_at: null,
  trade_date: null,
};

export function UpdateControl() {
  const { i18n } = useTranslation();
  const zh = i18n.language === "zh";
  const qc = useQueryClient();
  const [job, setJob] = useState<UpdateJob>(IDLE);
  const [visible, setVisible] = useState(false);
  const [starting, setStarting] = useState(false);
  const timer = useRef<number | null>(null);
  const hide = useRef<number | null>(null);

  const clearTimers = () => {
    if (timer.current != null) window.clearInterval(timer.current);
    if (hide.current != null) window.clearTimeout(hide.current);
    timer.current = null;
    hide.current = null;
  };

  const poll = async () => {
    try {
      const next = await api.updateStatus();
      setJob(next);
      if (next.state === "done") {
        clearTimers();
        qc.invalidateQueries();
        setVisible(true);
        hide.current = window.setTimeout(() => setVisible(false), 8000);
      } else if (next.state === "failed") {
        clearTimers();
        setVisible(true);
        hide.current = window.setTimeout(() => setVisible(false), 14000);
      }
    } catch {
      /* keep the last state; a transient failed poll should not look like a failed update */
    }
  };

  useEffect(() => {
    if (isStatic) return;
    api.updateStatus().then((next) => {
      setJob(next);
      if (next.state === "running") {
        setVisible(true);
        timer.current = window.setInterval(poll, 900);
      } else if (next.state === "done" && next.finished_at && Date.now() - new Date(next.finished_at).getTime() < 60_000) {
        setVisible(true);
        hide.current = window.setTimeout(() => setVisible(false), 8000);
      }
    }).catch(() => undefined);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (job.state !== "running") return;
    setVisible(true);
    if (timer.current == null) timer.current = window.setInterval(poll, 900);
    return () => {
      if (timer.current != null) window.clearInterval(timer.current);
      timer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.state]);

  const start = async () => {
    if (isStatic || starting || job.state === "running") return;
    setStarting(true);
    setVisible(true);
    try {
      const next = await api.startUpdate();
      setJob(next);
      if (timer.current == null) timer.current = window.setInterval(poll, 900);
    } catch {
      setJob({
        ...IDLE,
        state: "failed",
        message: zh ? "无法连接更新服务，请确认后端已启动" : "Could not reach the update service",
      });
      setVisible(true);
    } finally {
      setStarting(false);
    }
  };

  const running = job.state === "running";
  const done = job.state === "done";
  const failed = job.state === "failed";
  const pct = Math.max(2, Math.min(100, job.progress || 0));
  const label = running
    ? zh ? `更新中 ${pct}%` : `Updating ${pct}%`
    : zh ? "拉取今日数据" : "Fetch today";

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={isStatic || running || starting}
        className={`flex h-[34px] items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-medium transition-colors ${
          running
            ? "border-[var(--accent)]/50 bg-[var(--accent-soft)] text-[var(--accent)]"
            : "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/15"
        } disabled:cursor-default disabled:opacity-90`}
        title={zh ? "从 Tushare 拉取最新交易日并重算指标" : "Fetch the latest session and rebuild marts"}
        aria-label={label}
      >
        {running || starting ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />}
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">{running ? `${pct}%` : zh ? "更新" : "Sync"}</span>
      </button>

      {visible && (running || done || failed) && (
        <div className="fixed bottom-10 right-4 z-[80] w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--panel)] shadow-[var(--overlay-shadow)]">
          <div className="flex items-start gap-2.5 px-3 py-2.5">
            <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md ${done ? "bg-[var(--accent-soft)] text-[var(--accent)]" : failed ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}>
              {done ? <CheckCircle2 size={15} /> : failed ? <AlertTriangle size={15} /> : <Loader2 size={15} className="animate-spin" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[var(--text)]">
                  {done
                    ? zh ? "数据更新完成" : "Update complete"
                    : failed
                      ? zh ? "数据拉取失败" : "Update failed"
                      : zh ? "正在拉取今日数据" : "Fetching today's data"}
                </span>
                <button onClick={() => setVisible(false)} className="text-[var(--faint)] hover:text-[var(--text)]" aria-label="close">
                  <X size={12} />
                </button>
              </div>
              <div className="mt-1 truncate text-[11px] text-[var(--muted)]">
                {done
                  ? `${zh ? "最新交易日" : "Latest session"} ${job.trade_date ?? "—"}`
                  : failed
                    ? job.message
                    : `${job.message || (zh ? "准备中" : "Preparing")} · ${pct}%`}
              </div>
              <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-700 ease-out"
                  style={{ width: `${done ? 100 : pct}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[10px] text-[var(--faint)]">
                  {done
                    ? zh ? "行情、指标与状态已刷新" : "Prices, metrics and status refreshed"
                    : failed
                      ? zh ? "可以稍后重试，不会影响现有数据" : "Existing data is unchanged; retry later"
                      : zh ? "拉取 → 重算 → 刷新状态" : "Fetch → rebuild → status"}
                </span>
                {failed && (
                  <button onClick={start} className="text-[10.5px] font-medium text-[var(--accent)] hover:underline">
                    {zh ? "重试" : "Retry"}
                  </button>
                )}
                {done && (
                  <span className="mono text-[10px] text-[var(--faint)]">100%</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
