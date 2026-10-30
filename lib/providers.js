// Registro de provedores de LLM e de busca. Usado pelo background, pela página
// de opções e pelo eval. O modelo pode ser trocado nas opções (campo livre).
// Modelos padrão conferidos na documentação oficial de cada provedor em outubro de 2026.

export const LLM_PROVIDERS = {
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-6-luna",
    keyUrl: "https://platform.openai.com/api-keys",
    envKey: "OPENAI_API_KEY",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-haiku-5-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
    envKey: "ANTHROPIC_API_KEY",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    defaultModel: "gemini-3.8-flash",
    keyUrl: "https://aistudio.google.com/apikey",
    envKey: "GEMINI_API_KEY",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    defaultModel: "deepseek-flash",
    keyUrl: "https://platform.deepseek.com/api_keys",
    envKey: "DEEPSEEK_API_KEY",
  },
};

export const SEARCH_PROVIDERS = {
  duckduckgo: {
    id: "duckduckgo",
    label: "DuckDuckGo HTML (sem chave)",
    needsKey: false,
    note: "Lê a versão HTML do DuckDuckGo. Não é uma API oficial: pode falhar ou ser bloqueada, e aí sobra só a Wikipedia.",
  },
  brave: {
    id: "brave",
    label: "Brave Search API",
    needsKey: true,
    keyUrl: "https://api-dashboard.search.brave.com/",
    envKey: "BRAVE_API_KEY",
    note: "API oficial com chave própria.",
  },
  tavily: {
    id: "tavily",
    label: "Tavily",
    needsKey: true,
    keyUrl: "https://app.tavily.com/",
    envKey: "TAVILY_API_KEY",
    note: "API oficial com chave própria.",
  },
  none: {
    id: "none",
    label: "Só Wikipedia",
    needsKey: false,
    note: "Sem busca na web aberta. Usa só a API da Wikipedia (PT e EN).",
  },
};

export const DEFAULT_SETTINGS = {
  llmProvider: "openai",
  llmApiKey: "",
  llmModel: "",
  searchProvider: "duckduckgo",
  searchApiKey: "",
  maxClaims: 5,
};

export function getLlmProvider(id) {
  return LLM_PROVIDERS[id] || LLM_PROVIDERS[DEFAULT_SETTINGS.llmProvider];
}

export function resolveModel(settings) {
  const custom = String(settings?.llmModel || "").trim();
  return custom || getLlmProvider(settings?.llmProvider).defaultModel;
}
