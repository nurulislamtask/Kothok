/**
 * The 30 prebuilt Gemini voices. The style word is Google's own descriptor from the Gemini speech
 * documentation. Google does not publish a gender for these voices: `gender` is the widely
 * reported impression and may not match what you hear, and `uses` are our suggestions derived from
 * the style word. The UI says so wherever they are shown.
 */
export type Gender = "female" | "male";
export type UseCase = "story" | "product" | "explainer" | "casual";

export interface CatalogVoice {
  id: string;
  style: string;
  gender: Gender;
  uses: UseCase[];
}

export const USE_CASES: readonly UseCase[] = ["story", "product", "explainer", "casual"];

const v = (id: string, style: string, gender: Gender, uses: UseCase[]): CatalogVoice => ({ id, style, gender, uses });

export const GEMINI_CATALOG: readonly CatalogVoice[] = [
  v("Zephyr", "Bright", "female", ["product", "casual"]),
  v("Puck", "Upbeat", "male", ["product", "casual"]),
  v("Charon", "Informative", "male", ["explainer", "story"]),
  v("Kore", "Firm", "female", ["explainer", "product"]),
  v("Fenrir", "Excitable", "male", ["product", "casual"]),
  v("Leda", "Youthful", "female", ["casual", "story"]),
  v("Orus", "Firm", "male", ["explainer", "product"]),
  v("Aoede", "Breezy", "female", ["casual", "story"]),
  v("Callirrhoe", "Easy-going", "female", ["casual", "story"]),
  v("Autonoe", "Bright", "female", ["product", "casual"]),
  v("Enceladus", "Breathy", "male", ["story"]),
  v("Iapetus", "Clear", "male", ["explainer"]),
  v("Umbriel", "Easy-going", "male", ["casual", "story"]),
  v("Algieba", "Smooth", "male", ["story", "product"]),
  v("Despina", "Smooth", "female", ["story", "product"]),
  v("Erinome", "Clear", "female", ["explainer"]),
  v("Algenib", "Gravelly", "male", ["story"]),
  v("Rasalgethi", "Informative", "male", ["explainer"]),
  v("Laomedeia", "Upbeat", "female", ["product", "casual"]),
  v("Achernar", "Soft", "female", ["story"]),
  v("Alnilam", "Firm", "male", ["explainer", "product"]),
  v("Schedar", "Even", "male", ["explainer", "story"]),
  v("Gacrux", "Mature", "female", ["story", "explainer"]),
  v("Pulcherrima", "Forward", "female", ["product"]),
  v("Achird", "Friendly", "male", ["casual", "explainer"]),
  v("Zubenelgenubi", "Casual", "male", ["casual"]),
  v("Vindemiatrix", "Gentle", "female", ["story"]),
  v("Sadachbia", "Lively", "male", ["product", "casual"]),
  v("Sadaltager", "Knowledgeable", "male", ["explainer"]),
  v("Sulafat", "Warm", "female", ["story", "casual"]),
];

export function catalogVoice(id: string): CatalogVoice | undefined {
  return GEMINI_CATALOG.find((x) => x.id === id);
}

/** Natural-language delivery styles Gemini follows when written as "Say <style>: …". */
export const GEMINI_STYLES: ReadonlyArray<{ id: string; text: string }> = [
  { id: "whisper", text: "whisper quietly" },
  { id: "friendly", text: "in a warm, friendly way with small pauses" },
  { id: "narration", text: "like a dramatic narrator with rich vocal modulation" },
  { id: "promote", text: "with high energy, like an advertisement" },
  { id: "calm", text: "slowly and calmly" },
  { id: "sad", text: "sadly, with a low voice" },
  { id: "excited", text: "excitedly" },
  { id: "serious", text: "in a serious, firm tone" },
];
