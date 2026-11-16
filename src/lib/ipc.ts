import { invoke } from "@tauri-apps/api/core";

export interface AppErrorPayload {
  code: string;
  message: string;
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function isAppError(e: unknown): e is AppErrorPayload {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as AppErrorPayload).code === "string" &&
    typeof (e as AppErrorPayload).message === "string"
  );
}

// Settings live in SQLite when running inside Tauri. In a plain browser
// (`pnpm dev` without the shell) we fall back to localStorage so the UI
// can still be previewed.
export async function getSetting(key: string): Promise<string | null> {
  if (isTauri()) return invoke<string | null>("get_setting", { key });
  return localStorage.getItem(`kothok:${key}`);
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (isTauri()) {
    await invoke<void>("set_setting", { key, value });
    return;
  }
  localStorage.setItem(`kothok:${key}`, value);
}
