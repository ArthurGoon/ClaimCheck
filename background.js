import { checkPage } from "./lib/pipeline.js";
import { DEFAULT_SETTINGS, LLM_PROVIDERS, SEARCH_PROVIDERS, getLlmProvider, resolveModel } from "./lib/providers.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CLAIMCHECK_GET_SETTINGS") {
    loadSettings().then((s) =>
      sendResponse({
        ok: true,
        hasKey: Boolean(s.llmApiKey),
        providerLabel: getLlmProvider(s.llmProvider).label,
        model: resolveModel(s),
        searchLabel: SEARCH_PROVIDERS[s.searchProvider]?.label || s.searchProvider,
      })
    );
    return true;
  }

  if (message?.type === "CLAIMCHECK_VERIFY") {
    handleVerify(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err?.message || "Erro inesperado ao verificar." }));
    return true;
  }
  return false;
});

/** Lê as configurações do storage local. Migra o formato antigo (sync: apiKey/provider). */
async function loadSettings() {
  const local = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const settings = { ...DEFAULT_SETTINGS, ...local };

  if (!settings.llmApiKey) {
    const legacy = await chrome.storage.sync.get(["apiKey", "openaiApiKey", "provider"]);
    const legacyKey = (legacy.apiKey || legacy.openaiApiKey || "").trim();
    if (legacyKey) {
      settings.llmApiKey = legacyKey;
      if (LLM_PROVIDERS[legacy.provider]) settings.llmProvider = legacy.provider;
      await chrome.storage.local.set({ llmApiKey: settings.llmApiKey, llmProvider: settings.llmProvider });
      await chrome.storage.sync.remove(["apiKey", "openaiApiKey", "provider"]);
    }
  }
  return settings;
}

async function handleVerify({ mode }) {
  const settings = await loadSettings();
  if (!settings.llmApiKey) {
    return { ok: false, code: "NO_API_KEY", error: "Configure sua API key nas opções da extensão." };
  }
  const searchInfo = SEARCH_PROVIDERS[settings.searchProvider];
  if (searchInfo?.needsKey && !settings.searchApiKey) {
    return { ok: false, code: "NO_API_KEY", error: `A busca ${searchInfo.label} precisa de uma chave. Configure nas opções.` };
  }

  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: "Nenhuma aba ativa encontrada." };
  if (!/^https?:/i.test(tab.url || "")) {
    return { ok: false, error: "Abra uma página web comum (http ou https) para analisar." };
  }

  const page = await extractFromTab(tab.id, mode || "article");
  if (!page.ok) return page;

  const report = await checkPage({
    page,
    settings,
    onProgress: (progress) => {
      chrome.runtime.sendMessage({ type: "CLAIMCHECK_PROGRESS", ...progress }).catch(() => {});
    },
  });

  return {
    ok: true,
    claims: report.results,
    warnings: report.warnings,
    meta: {
      url: page.url,
      title: page.title,
      mode: page.mode,
      charCount: page.text.length,
      pageSummary: report.pageSummary,
      provider: getLlmProvider(settings.llmProvider).label,
      model: resolveModel(settings),
      search: searchInfo?.label || settings.searchProvider,
    },
  };
}

async function extractFromTab(tabId, mode) {
  try {
    // Injeta sob demanda: não há content script fixo rodando em todas as páginas.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["lib/extract.js", "content.js"] });
    const result = await chrome.tabs.sendMessage(tabId, { type: "CLAIMCHECK_EXTRACT", mode });
    if (!result?.ok) return { ok: false, error: result?.error || "Falha na extração de texto." };
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err?.message || "Não foi possível acessar esta página. Recarregue a aba e tente de novo.",
    };
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) return tab;
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  return current || null;
}
