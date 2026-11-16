import { useTranslation } from "react-i18next";
import { Hammer } from "lucide-react";
import type { RouteId } from "../app/nav";

export default function ComingSoon({ route, phase }: { route: RouteId; phase: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Hammer className="size-5" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold">{t(`nav.${route}`)}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("comingSoon.title")} — {t("comingSoon.body", { phase })}
      </p>
    </div>
  );
}
