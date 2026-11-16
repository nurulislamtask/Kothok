import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { APP_VERSION } from "../lib/version";

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

// Provider and task indicators are wired to real data in Phase 3 (provider
// manager) and the task manager; until then they truthfully report "none".
export default function StatusBar() {
  const { t } = useTranslation();
  const online = useOnline();

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t bg-sidebar px-4 text-xs text-muted-foreground">
      <span>{t("status.noProvider")}</span>
      <span className="flex items-center gap-1.5">
        <span
          className={online ? "size-1.5 rounded-full bg-emerald-500" : "size-1.5 rounded-full bg-amber-500"}
          aria-hidden
        />
        {online ? t("status.online") : t("status.offline")}
      </span>
      <span>{t("status.noTasks")}</span>
      <span className="ms-auto">v{APP_VERSION}</span>
    </footer>
  );
}
