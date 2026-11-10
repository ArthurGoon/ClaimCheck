import { checkPage } from "./lib/pipeline.js";
import { testConnection, LLMError } from "./lib/llm.js";
import { AbortedError } from "./lib/http.js";
import { SEARCH_PROVIDERS, STORAGE_KEYS, getLlmProvider, resolveModel, runtimeSettings } from "./lib/providers.js";

// Chave usada só pelos scripts de teste (scripts/screenshots.mjs) para ligar o modelo simulado.
const DEV_MOCK_KEY = "claimcheckDevMock";
const MIN_PAGE_CHARS = 40;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    CLAIMCHECK_TEST_CONNECTION: () => handleTestConnection(message.settings),
    CLAIMCHECK_HIGHLIGHT: () => handleHighlight(message),
  };
  const handler = handlers[message?.type];
  if (!handler) return false;
  handler()
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err?.message || "Erro inesperado." }));
  return true;
});

// A verificação roda numa porta aberta pelo painel: o progresso vai chegando
// pela mesma porta e, se o painel fechar ou cancelar, a porta cai e tudo é abortado.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "claimcheck-run") return;
  const controller = new AbortController();
  let open = true;
  port.onDisconnect.addListener(() => {
    open = false;
    controller.abort();
  });
  const post = (msg) => {
    if (open) port.postMessage(msg);
  };

  port.onMessage.addListener((msg) => {
    if (msg?.type !== "start") return; // "ping" só mantém o service worker acordado
    runCheck({ tabId: msg.tabId, mode: msg.mode, signal: controller.signal, post })
      .then((report) => post({ type: "done", report }))
      .catch((err) => {
        if (err instanceof AbortedError || controller.signal.aborted) return;
        post({ type: "error", error: err?.message || "Erro inesperado ao verificar.", code: err?.code || "" });
      });
  });
});

async function loadSettings() {
  const stored = await chrome.storage.local.get([...STORAGE_KEYS, DEV_MOCK_KEY]);
  const settings = runtimeSettings(stored);
  if (stored[DEV_MOCK_KEY]) {
    settings.llmProvider = "mock";
    settings.llmApiKey = "mock";
    settings.llmModel = "modelo-simulado";
    settings.mockScript = stored[DEV_MOCK_KEY];
  }
  return settings;
}

function describeSettings(settings) {
  const provider = settings.llmProvider === "mock" ? "Modelo simulado (teste)" : getLlmProvider(settings.llmProvider).label;
  return {
    provider,
    model: resolveModel(settings),
    search: SEARCH_PROVIDERS[settings.searchProvider]?.label || "Só Wikipedia",
    searchProvider: settings.searchProvider,
  };
}

class CheckError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function runCheck({ tabId, mode, signal, post }) {
  const settings = await loadSettings();
  if (!settings.llmApiKey) throw new CheckError("Configure um provedor e uma chave para começar.", "NO_KEY");
  const search = SEARCH_PROVIDERS[settings.searchProvider];
  if (search?.needsKey && !settings.searchApiKey) {
    throw new CheckError(`A busca ${search.label} precisa de uma chave. Confira nas configurações.`, "NO_KEY");
  }

  post({ type: "progress", step: "read" });
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new CheckError("A aba não está mais aberta.", "NO_TAB");
  if (!/^https?:/i.test(tab.url || "")) {
    throw new CheckError("O ClaimCheck lê páginas da web comuns. Páginas internas do navegador ficam de fora.", "UNSUPPORTED_PAGE");
  }

  const page = await extractFromTab(tabId, mode);
  if (signal.aborted) throw new AbortedError();
  post({ type: "progress", step: "page", title: page.title, url: page.url, chars: page.text.length,
    totalChars: page.totalChars, truncated: page.truncated, mode });

  const report = await checkPage({
    page,
    settings,
    deps: { signal },
    onProgress: (progress) => post({ type: "progress", ...progress }),
  });

  const result = {
    tabId,
    url: page.url,
    title: page.title,
    mode,
    pageSummary: report.pageSummary,
    claims: report.results,
    warnings: report.warnings,
    meta: { ...describeSettings(settings), charCount: page.text.length, totalChars: page.totalChars,
      truncated: page.truncated, finishedAt: Date.now() },
  };
  // Guarda o último resultado da aba para o painel mostrar de novo se for reaberto.
  await chrome.storage.session.set({ [`report:${tabId}`]: result }).catch(() => {});
  return result;
}

async function extractFromTab(tabId, mode) {
  let result;
  try {
    // Injeta sob demanda: não há content script fixo rodando em todas as páginas.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["lib/extract.js", "content.js"] });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (m) => window.ClaimCheckPage.extract(m),
      args: [mode],
    });
    result = injection?.result;
  } catch (err) {
    const blocked = /cannot be scripted|cannot access|extensions gallery|chrome:\/\//i.test(err?.message || "");
    throw new CheckError(
      blocked
        ? "O navegador não deixa extensões lerem esta página."
        : "Não consegui ler esta página. Recarregue a aba e tente de novo.",
      "UNSUPPORTED_PAGE"
    );
  }

  if (!result?.text) {
    if (mode === "selection") {
      throw new CheckError("Nenhum texto selecionado. Selecione um trecho na página e tente de novo.", "NO_SELECTION");
    }
    throw new CheckError("Não encontrei texto nesta página.", "NO_TEXT");
  }
  if (mode !== "selection" && result.text.length < MIN_PAGE_CHARS) {
    throw new CheckError("Esta página tem pouco texto para verificar.", "NO_TEXT");
  }
  return result;
}

async function handleTestConnection(candidate) {
  const stored = await chrome.storage.local.get(DEV_MOCK_KEY);
  const settings = runtimeSettings(candidate || {});
  if (stored[DEV_MOCK_KEY]) {
    settings.llmProvider = "mock";
    settings.llmApiKey = "mock";
    settings.mockScript = stored[DEV_MOCK_KEY];
  }
  if (!settings.llmApiKey) return { ok: false, error: "Cole a chave antes de testar.", code: "NO_KEY" };
  try {
    const out = await testConnection({
      provider: settings.llmProvider,
      apiKey: settings.llmApiKey,
      model: resolveModel(settings),
      mockScript: settings.mockScript,
    });
    return { ok: true, elapsedMs: out.elapsedMs, model: settings.mockScript ? "O modelo simulado" : resolveModel(settings) };
  } catch (err) {
    return { ok: false, error: err?.message || "Falhou.", code: err instanceof LLMError ? err.code : "" };
  }
}

async function handleHighlight({ tabId, quote, text }) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["lib/extract.js", "content.js"] });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (q, t) => window.ClaimCheckPage.highlight(q, t),
      args: [quote || "", text || ""],
    });
    return { ok: true, found: Boolean(injection?.result) };
  } catch (_) {
    return { ok: false, found: false };
  }
}
