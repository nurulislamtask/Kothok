import { create } from "zustand";

/** Selection shared between Voice Library and Voice Studio. */
interface VoiceState {
  providerId: string;
  voiceId: string;
  lang: string;
  text: string;
  set: (patch: Partial<Omit<VoiceState, "set">>) => void;
}

export const useVoice = create<VoiceState>((set) => ({
  providerId: "",
  voiceId: "",
  lang: "bn-BD",
  text: "",
  set: (patch) => set(patch),
}));
