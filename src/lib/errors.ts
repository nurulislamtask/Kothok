import i18n from "../i18n";
import { isAppError } from "./ipc";

/** User-facing, translated text for any error thrown by a backend command. */
export function errorText(e: unknown): string {
  if (isAppError(e)) {
    const base = i18n.t(`errors.${e.code}`, { defaultValue: i18n.t("errors.unknown") });
    const detail = (e as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail && e.code !== "needs_confirmation") {
      return `${base} (${detail})`;
    }
    return base;
  }
  return i18n.t("errors.unknown");
}

export function errorCode(e: unknown): string | null {
  return isAppError(e) ? e.code : null;
}

export function errorDetail(e: unknown): string | null {
  const d = (e as { detail?: unknown } | null)?.detail;
  return typeof d === "string" ? d : null;
}
