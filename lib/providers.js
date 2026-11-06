// Registro de provedores de LLM e de busca. Usado pelo background, pelo painel e pelo eval.
// Modelos conferidos no catálogo da OpenRouter e na documentação de cada provedor em novembro de 2026.
// O campo de modelo também aceita qualquer id digitado pelo usuário.

export const LLM_PROVIDERS = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    who: "OpenRouter",
    fem: true,
    blurb: "Uma chave para vários modelos",
    defaultModel: "openai/gpt-6-luna",
    models: [
      { id: "openai/gpt-6-luna", label: "GPT-6 Luna" },
      { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5" },
      { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" },
      { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
      { id: "qwen/qwen3.8-flash", label: "Qwen 3.8 Flash" },
    ],
    keyUrl: "https://openrouter.ai/settings/keys",
    keyHint: "sk-or-...",
    keyPattern: /^sk-or-/,
    envKey: "OPENROUTER_API_KEY",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    who: "Anthropic",
    fem: true,
    blurb: "Claude direto da Anthropic",
    defaultModel: "claude-haiku-5-5",
    models: [
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    ],
    keyUrl: "https://platform.claude.com/settings/keys",
    keyHint: "sk-ant-...",
    keyPattern: /^sk-ant-/,
    envKey: "ANTHROPIC_API_KEY",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    who: "OpenAI",
    fem: true,
    blurb: "GPT direto da OpenAI",
    defaultModel: "gpt-6-luna",
    models: [
      { id: "gpt-6-luna", label: "GPT-6 Luna" },
      { id: "gpt-6-luna-pro", label: "GPT-6 Luna Pro" },
    ],
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "sk-...",
    keyPattern: /^sk-(?!or-|ant-)/,
    envKey: "OPENAI_API_KEY",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    who: "Google AI Studio",
    fem: false,
    blurb: "Gemini direto do Google",
    defaultModel: "gemini-3.8-flash",
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
    ],
    keyUrl: "https://aistudio.google.com/apikey",
    keyHint: "AIza...",
    keyPattern: /^AIza/,
    envKey: "GEMINI_API_KEY",
  },
};

export const SEARCH_PROVIDERS = {
  wikipedia: {
    id: "wikipedia",
    label: "Só Wikipedia",
    needsKey: false,
    note: "Sem chave. Usa a API oficial da Wikipedia, no idioma da página e em inglês.",
  },
  tavily: {
    id: "tavily",
    label: "Wikipedia + Tavily",
    needsKey: true,
    keyUrl: "https://app.tavily.com/",
    keyHint: "tvly-...",
    envKey: "TAVILY_API_KEY",
    note: "Busca na web aberta. O plano gratuito da Tavily dá 1.000 créditos por mês.",
  },
  brave: {
    id: "brave",
    label: "Wikipedia + Brave",
    needsKey: true,
    keyUrl: "https://api-dashboard.search.brave.com/",
    keyHint: "BSA...",
    envKey: "BRAVE_API_KEY",
    note: "Busca na web aberta pela API oficial do Brave Search.",
  },
};

export const MAX_CLAIMS_OPTIONS = [3, 5, 8];

// Formato salvo no storage local da extensão. Uma chave e um modelo por provedor,
// para dar para trocar de provedor sem perder o que já foi colado.
export const DEFAULT_STORED = {
  llmProvider: "openrouter",
  llmKeys: {},
  llmModels: {},
  searchProvider: "wikipedia",
  searchKeys: {},
  maxClaims: 5,
};

// Chaves do formato antigo, lidas só para migrar.
const LEGACY_KEYS = ["llmApiKey", "llmModel", "searchApiKey"];
export const STORAGE_KEYS = [...Object.keys(DEFAULT_STORED), ...LEGACY_KEYS];

export function getLlmProvider(id) {
  return LLM_PROVIDERS[id] || LLM_PROVIDERS[DEFAULT_STORED.llmProvider];
}

/**
 * Nome do provedor com artigo ou preposição certos: "a OpenRouter", "da OpenRouter",
 * "no Google AI Studio". prep: "" | "de" | "em" | "por".
 */
export function providerName(id, prep = "") {
  const p = getLlmProvider(id);
  const forms = p.fem ? { "": "a", de: "da", em: "na", por: "pela" } : { "": "o", de: "do", em: "no", por: "pelo" };
  return `${forms[prep]} ${p.who}`;
}

export function resolveModel(settings) {
  const custom = String(settings?.llmModel || "").trim();
  return custom || getLlmProvider(settings?.llmProvider).defaultModel;
}

/** Adivinha o provedor pelo começo da chave colada (sk-or-, sk-ant-, AIza, sk-). */
export function guessProviderFromKey(key) {
  const value = String(key || "").trim();
  if (!value) return "";
  return Object.values(LLM_PROVIDERS).find((p) => p.keyPattern.test(value))?.id || "";
}

/** Normaliza o que está salvo, inclusive o formato da versão anterior (uma chave solta). */
export function normalizeStored(raw = {}) {
  const stored = {
    ...DEFAULT_STORED,
    ...raw,
    llmKeys: { ...(raw.llmKeys || {}) },
    llmModels: { ...(raw.llmModels || {}) },
    searchKeys: { ...(raw.searchKeys || {}) },
  };

  if (raw.llmApiKey && raw.llmProvider && !stored.llmKeys[raw.llmProvider]) stored.llmKeys[raw.llmProvider] = raw.llmApiKey;
  if (raw.llmModel && raw.llmProvider && !stored.llmModels[raw.llmProvider]) stored.llmModels[raw.llmProvider] = raw.llmModel;
  if (raw.searchApiKey && raw.searchProvider && !stored.searchKeys[raw.searchProvider]) {
    stored.searchKeys[raw.searchProvider] = raw.searchApiKey;
  }

  if (!LLM_PROVIDERS[stored.llmProvider]) stored.llmProvider = DEFAULT_STORED.llmProvider;
  if (!SEARCH_PROVIDERS[stored.searchProvider]) stored.searchProvider = DEFAULT_STORED.searchProvider;
  const maxClaims = Number(stored.maxClaims);
  stored.maxClaims = Number.isFinite(maxClaims) ? Math.min(8, Math.max(1, Math.round(maxClaims))) : DEFAULT_STORED.maxClaims;

  for (const key of LEGACY_KEYS) delete stored[key];
  return stored;
}

/** Configuração no formato que o pipeline usa (uma chave e um modelo ativos). */
export function runtimeSettings(raw) {
  const s = normalizeStored(raw);
  return {
    llmProvider: s.llmProvider,
    llmApiKey: String(s.llmKeys[s.llmProvider] || "").trim(),
    llmModel: String(s.llmModels[s.llmProvider] || "").trim(),
    searchProvider: s.searchProvider,
    searchApiKey: String(s.searchKeys[s.searchProvider] || "").trim(),
    maxClaims: s.maxClaims,
  };
}
