import type { Category, CostClass } from "../../lib/api";

export interface Preset {
  id: string;
  category: Category;
  adapter: string;
  endpoint: string;
  costClass: CostClass;
}

// Endpoints are the providers' documented base URLs. Cost classes are
// deliberately conservative: anything that can bill money is "paid", so the
// fallback system asks before using it. Users can change the class per provider.
export const PRESETS: readonly Preset[] = [
  { id: "gemini", category: "text", adapter: "gemini", endpoint: "", costClass: "free_tier" },
  { id: "openrouter", category: "text", adapter: "openai_compat", endpoint: "https://openrouter.ai/api/v1", costClass: "paid" },
  { id: "openai", category: "text", adapter: "openai_compat", endpoint: "https://api.openai.com/v1", costClass: "paid" },
  { id: "groq", category: "text", adapter: "openai_compat", endpoint: "https://api.groq.com/openai/v1", costClass: "free_tier" },
  { id: "ollama", category: "text", adapter: "openai_compat", endpoint: "http://localhost:11434/v1", costClass: "local" },
  { id: "lmstudio", category: "text", adapter: "openai_compat", endpoint: "http://localhost:1234/v1", costClass: "local" },
  { id: "custom", category: "text", adapter: "openai_compat", endpoint: "", costClass: "paid" },
  { id: "gemini_image", category: "image", adapter: "gemini_image", endpoint: "", costClass: "paid" },
  { id: "openai_images", category: "image", adapter: "openai_images", endpoint: "https://api.openai.com/v1", costClass: "paid" },
  { id: "custom_image", category: "image", adapter: "openai_images", endpoint: "", costClass: "paid" },
  { id: "gemini_tts", category: "tts", adapter: "gemini_tts", endpoint: "", costClass: "free_tier" },
  { id: "gemini_stt", category: "stt", adapter: "gemini_stt", endpoint: "", costClass: "free_tier" },
  { id: "google_tts", category: "tts", adapter: "google_tts", endpoint: "", costClass: "paid" },
  { id: "openai_tts", category: "tts", adapter: "openai_tts", endpoint: "https://api.openai.com/v1", costClass: "paid" },
  { id: "custom_tts", category: "tts", adapter: "openai_tts", endpoint: "", costClass: "paid" },
  { id: "groq_stt", category: "stt", adapter: "openai_stt", endpoint: "https://api.groq.com/openai/v1", costClass: "free_tier" },
  { id: "openai_stt", category: "stt", adapter: "openai_stt", endpoint: "https://api.openai.com/v1", costClass: "paid" },
  { id: "local_stt", category: "stt", adapter: "openai_stt", endpoint: "http://localhost:8000/v1", costClass: "local" },
  { id: "whisper_local", category: "stt", adapter: "whisper_local", endpoint: "", costClass: "local" },
  { id: "elevenlabs_clone", category: "clone", adapter: "elevenlabs_clone", endpoint: "", costClass: "paid" },
  { id: "custom_stt", category: "stt", adapter: "openai_stt", endpoint: "", costClass: "paid" },
];

/** Provider categories that have working adapters in this build. */
export const CATEGORIES: readonly Category[] = ["text", "image", "tts", "clone", "stt"];

export const COST_CLASSES: readonly CostClass[] = ["local", "free", "free_tier", "paid"];
