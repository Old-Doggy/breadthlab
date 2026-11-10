import { useTranslation } from "react-i18next";

export default function Placeholder({ page }: { page: string }) {
  const { t } = useTranslation();
  return (
    <div className="card flex min-h-[420px] flex-col items-center justify-center gap-3">
      <div className="micro">{t("brand")}</div>
      <div className="text-[18px] font-semibold">{t(`nav.${page}`)}</div>
      <div className="text-[12px] text-[var(--muted)]">{t("common.loading")}</div>
    </div>
  );
}
