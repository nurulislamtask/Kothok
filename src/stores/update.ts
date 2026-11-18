import { create } from "zustand";
import { api, type UpdateInfo } from "../lib/api";
import { errorText } from "../lib/errors";

interface UpdateState {
  info: UpdateInfo | null;
  checking: boolean;
  checkedAt: number | null;
  error: string | null;
  check: () => Promise<UpdateInfo | null>;
}

export const useUpdate = create<UpdateState>((set) => ({
  info: null,
  checking: false,
  checkedAt: null,
  error: null,
  check: async () => {
    set({ checking: true, error: null });
    try {
      const info = await api.checkUpdate();
      set({ info, checking: false, checkedAt: Date.now() });
      return info;
    } catch (e) {
      set({ checking: false, error: errorText(e), checkedAt: Date.now() });
      return null;
    }
  },
}));
