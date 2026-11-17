import type { CostClass } from "../../lib/api";

export interface Preset {
  id: string;
  adapter: "gemini" | "openai_compat";
  endpoint: string;
  costClass: CostClass;
}

// Endpoints are the providers' documented base URLs. Cost classes are
// deliberately conservative: anything that can bill money is "paid", so the
// fallback system asks before using it. Users can change the class per provider.
export const PRESETS: readonly Preset[] = [
  { id: "gemini", adapter: "gemini", endpoint: "", costClass: "free_tier" },
  { id: "openrouter", adapter: "openai_compat", endpoint: "https://openrouter.ai/api/v1", costClass: "paid" },
  { id: "openai", adapter: "openai_compat", endpoint: "https://api.openai.com/v1", costClass: "paid" },
  { id: "groq", adapter: "openai_compat", endpoint: "https://api.groq.com/openai/v1", costClass: "free_tier" },
  { id: "ollama", adapter: "openai_compat", endpoint: "http://localhost:11434/v1", costClass: "local" },
  { id: "lmstudio", adapter: "openai_compat", endpoint: "http://localhost:1234/v1", costClass: "local" },
  { id: "custom", adapter: "openai_compat", endpoint: "", costClass: "paid" },
];

export const COST_CLASSES: readonly CostClass[] = ["local", "free", "free_tier", "paid"];
