// Prompt construction is plain TypeScript so it can be unit-tested and so the
// instructions sent to the model are always in English, independent of the UI
// language. Only the *output* language is user-controlled.

export type OutLang = "bn" | "en" | "mixed";
export type Length = "short" | "medium" | "long";
export type Op = "generate" | "continue" | "rewrite" | "expand" | "shorten" | "grammar" | "translate";

export const CONTENT_TYPES = [
  "youtube_script",
  "blog_article",
  "facebook_post",
  "social_caption",
  "product_description",
  "seo_article",
  "marketing_copy",
  "video_intro",
  "video_hook",
  "youtube_titles",
  "video_description",
  "hashtags",
  "outline",
  "storytelling",
  "educational_script",
  "news_script",
  "custom",
] as const;

export const TONES = [
  "professional",
  "friendly",
  "casual",
  "enthusiastic",
  "formal",
  "humorous",
  "inspirational",
  "persuasive",
  "emotional",
  "neutral",
] as const;

export const STYLES = ["informative", "conversational", "storytelling", "persuasive", "descriptive", "concise"] as const;

export const PLATFORMS = ["none", "youtube", "facebook", "instagram", "tiktok", "blog", "website", "x", "linkedin"] as const;

export const LENGTHS: readonly Length[] = ["short", "medium", "long"];

const TYPE_PROMPT: Record<string, string> = {
  youtube_script: "a YouTube video script (spoken narration with a hook, body and call to action)",
  blog_article: "a blog article with a title, headings and paragraphs",
  facebook_post: "a Facebook post",
  social_caption: "a social media caption",
  product_description: "a product description",
  seo_article: "an SEO-optimised article with a title, headings and natural keyword use",
  marketing_copy: "marketing copy",
  video_intro: "a video introduction (the first 15-30 seconds of narration)",
  video_hook: "5 alternative attention-grabbing video hooks (numbered)",
  youtube_titles: "10 YouTube title options (numbered), each under 70 characters",
  video_description: "a YouTube video description with a summary and relevant keywords",
  hashtags: "a list of relevant hashtags",
  outline: "a structured content outline with headings and bullet points",
  storytelling: "a story",
  educational_script: "an educational script that explains the topic clearly step by step",
  news_script: "a news-style script read by an anchor",
  custom: "the content described in the instructions",
};

const LENGTH_PROMPT: Record<Length, string> = {
  short: "Keep it short (roughly 150-300 words).",
  medium: "Medium length (roughly 400-700 words).",
  long: "Long and detailed (roughly 900-1500 words).",
};

export function languageRule(lang: OutLang): string {
  switch (lang) {
    case "bn":
      return "Write the output entirely in Bengali (Bangla) using Bengali script, in standard Bangla as used in Bangladesh. Do not transliterate Bangla into Latin letters.";
    case "en":
      return "Write the output in clear, natural English.";
    case "mixed":
      return "Write in the natural Bangla-English mixed style commonly used in Bangladesh: Bengali script for Bangla words and Latin script for English words and technical terms.";
  }
}

const BASE_SYSTEM =
  "You are a professional writer and editor. Return only the requested text, with no preamble, no explanations and no surrounding quotation marks. Use plain text or simple Markdown (# headings, - bullets) only.";

export interface Settings {
  contentType: string;
  lang: OutLang;
  tone: string;
  style: string;
  length: Length;
  audience: string;
  platform: string;
  instructions: string;
  topic: string;
}

export interface Built {
  system: string;
  prompt: string;
}

function brief(s: Settings): string {
  const lines = [`Tone: ${s.tone}.`, `Writing style: ${s.style}.`];
  if (s.audience.trim()) lines.push(`Target audience: ${s.audience.trim()}.`);
  if (s.platform !== "none") lines.push(`Platform: ${s.platform}.`);
  if (s.instructions.trim()) lines.push(`Extra instructions: ${s.instructions.trim()}`);
  return lines.join("\n");
}

export function buildPrompt(
  op: Op,
  s: Settings,
  ctx: { body: string; selection: string; targetLang: "bn" | "en" },
): Built {
  const target = ctx.selection.trim() ? ctx.selection : ctx.body;
  const scope = ctx.selection.trim() ? "the selected text" : "the whole text";
  const rule = languageRule(s.lang);
  const system = `${BASE_SYSTEM}\n${rule}`;

  switch (op) {
    case "generate":
      return {
        system,
        prompt: `Write ${TYPE_PROMPT[s.contentType] ?? TYPE_PROMPT["custom"]}.\n\nTopic / request:\n${s.topic.trim()}\n\n${brief(s)}\n${LENGTH_PROMPT[s.length]}`,
      };
    case "continue":
      return {
        system,
        prompt: `Continue writing the text below from exactly where it stops. Match its language, tone and style. Output only the new continuation, not the existing text.\n\n${brief(s)}\n\nTEXT:\n${ctx.body}`,
      };
    case "rewrite":
      return {
        system,
        prompt: `Rewrite ${scope} below so it reads better while keeping the same meaning.\n\n${brief(s)}\n\nTEXT:\n${target}`,
      };
    case "expand":
      return {
        system,
        prompt: `Expand ${scope} below with more detail, examples and depth. Keep the same language and tone.\n\nTEXT:\n${target}`,
      };
    case "shorten":
      return {
        system,
        prompt: `Shorten ${scope} below to roughly half its length, keeping the key points. Keep the same language and tone.\n\nTEXT:\n${target}`,
      };
    case "grammar":
      return {
        system: `${BASE_SYSTEM}\nKeep the text in its original language.`,
        prompt: `Fix grammar, spelling and punctuation in ${scope} below. Do not change the meaning, wording choices or style more than necessary. Return the corrected text only.\n\nTEXT:\n${target}`,
      };
    case "translate": {
      const name = ctx.targetLang === "bn" ? "Bengali (Bangla, Bengali script, as used in Bangladesh)" : "English";
      return {
        system: BASE_SYSTEM,
        prompt: `Translate ${scope} below into ${name}. Keep the meaning, tone and formatting.\n\nTEXT:\n${target}`,
      };
    }
  }
}

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}
