export const PROVIDERS = {
  gemini: {
    id: "gemini",
    label: "Gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    model: "gemini-2.0-flash",
    docsUrl: "https://aistudio.google.com/apikey",
    supportsJsonMode: true,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    docsUrl: "https://platform.openai.com/api-keys",
    supportsJsonMode: true,
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    url: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
    docsUrl: "https://platform.deepseek.com/api_keys",
    supportsJsonMode: true,
  },
};

export function getProvider(id) {
  return PROVIDERS[id] || PROVIDERS.deepseek;
}
