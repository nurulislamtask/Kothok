import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { APP_VERSION } from "../lib/version";
import { defaultProvider, useProviders } from "../stores/providers";
import { useTasks } from "../stores/tasks";

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

export default function StatusBar() {
  const { t } = useTranslation();
  const online = useOnline();
  const providers = useProviders((s) => s.providers);
  const defaults = useProviders((s) => s.defaults);
  const running = useTasks((s) => Object.keys(s.running).length);
  const provider = defaultProvider({ providers, defaults }, "text");

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t bg-sidebar px-4 text-xs text-muted-foreground">
      <span>{provider ? t("status.provider", { name: provider.displayName }) : t("status.noProvider")}</span>
      <span className="flex items-center gap-1.5">
        <span
          className={online ? "size-1.5 rounded-full bg-emerald-500" : "size-1.5 rounded-full bg-amber-500"}
          aria-hidden
        />
        {online ? t("status.online") : t("status.offline")}
      </span>
      <span className="flex items-center gap-1.5">
        {running > 0 && <Loader2 className="size-3 animate-spin" aria-hidden />}
        {running > 0 ? t("status.tasks", { count: running }) : t("status.noTasks")}
      </span>
      <span className="ms-auto">v{APP_VERSION}</span>
    </footer>
  );
}
