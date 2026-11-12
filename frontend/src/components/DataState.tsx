import { useTranslation } from "react-i18next";

export function DataState({ error = false, loading = false }: { error?: boolean; loading?: boolean }) {
  const { i18n } = useTranslation();
  const en = i18n.language === "en";
  return <div role={error ? "alert" : "status"} className="card flex min-h-[180px] items-center justify-center p-6 text-sm text-[var(--muted)]">
    {loading ? (en ? "Loading data…" : "正在加载数据…") : error
      ? (en ? "Data unavailable. The database may be updating; please retry shortly." : "数据暂不可用，数据库可能正在更新，请稍后重试。")
      : (en ? "No data is available for this view." : "当前视图暂无可用数据。")}
  </div>;
}
