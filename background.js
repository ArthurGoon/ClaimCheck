import { EXTRACT_SYSTEM_PROMPT, buildExtractPrompt } from "./lib/prompts.js";
import { CONTEXT_SYSTEM_PROMPT, buildContextPrompt } from "./lib/context.js";
import { getProvider } from "./lib/providers.js";
import { investigateClaims } from "./lib/search-agent.js";
import { verifyClaimsWithEvidence } from "./lib/verify.js";
import { parseJsonContent } from "./lib/utils.js";

const MAX_CLAIMS_TO_VERIFY = 6;

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (_) {
    /* sidePanel may already be open */
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return false;

  if (message.type === "CLAIMCHECK_GET_SETTINGS") {
    chrome.storage.sync.get(["apiKey", "openaiApiKey", "provider"], (data) => {
      const apiKey = (data.apiKey || data.openaiApiKey || "").trim();
      const provider = getProvider(data.provider || "deepseek");
      sendResponse({
        ok: true,
        hasKey: Boolean(apiKey),
        provider: provider.id,
        providerLabel: provider.label,
      });
    });
    return true;
  }

  if (message.type === "CLAIMCHECK_VERIFY") {
    handleVerify(message)
      .then((result) => sendResponse(result))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err?.message || "Erro inesperado ao verificar.",
        })
      );
    return true;
  }

  return false;
});

async function handleVerify({ mode }) {
  const stored = await chrome.storage.sync.get(["apiKey", "openaiApiKey", "provider"]);
  const apiKey = (stored.apiKey || stored.openaiApiKey || "").trim();
  const provider = getProvider(stored.provider || "deepseek");

  if (!apiKey) {
    return {
      ok: false,
      code: "NO_API_KEY",
      error: "Configure sua API key nas opções da extensão.",
    };
  }

  const tab = await getTargetTab();
  if (!tab?.id) {
    return { ok: false, error: "Nenhuma aba ativa encontrada." };
  }

  if (isRestrictedUrl(tab.url)) {
    return {
      ok: false,
      error: "Abra uma página web comum (http/https) para analisar.",
    };
  }

  let extractResult;
  try {
    extractResult = await chrome.tabs.sendMessage(tab.id, {
      type: "CLAIMCHECK_EXTRACT",
      mode: mode || "article",
    });
  } catch (_) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["lib/extract.js", "content.js"],
      });
      extractResult = await chrome.tabs.sendMessage(tab.id, {
        type: "CLAIMCHECK_EXTRACT",
        mode: mode || "article",
      });
    } catch (injectErr) {
      return {
        ok: false,
        error:
          injectErr?.message ||
          "Não foi possível acessar esta página. Recarregue a aba e tente de novo.",
      };
    }
  }

  if (!extractResult?.ok) {
    return {
      ok: false,
      error: extractResult?.error || "Falha na extração de texto.",
    };
  }

  const pageUnderstanding = await understandPage(
    provider,
    apiKey,
    extractResult.text,
    extractResult.url,
    extractResult.title
  );

  const claimItems = await extractClaims(
    provider,
    apiKey,
    extractResult.text,
    extractResult.url,
    pageUnderstanding
  );

  if (!claimItems.length) {
    return {
      ok: true,
      claims: [],
      meta: buildMeta(extractResult, pageUnderstanding, { claimCount: 0, withResults: 0 }),
    };
  }

  const claimsWithEvidence = await investigateClaims(
    claimItems,
    {
      pageTitle: extractResult.title,
      pageUrl: extractResult.url,
      pageText: extractResult.text,
    },
    pageUnderstanding
  );
  const claims = await verifyClaimsWithEvidence(
    provider,
    apiKey,
    claimsWithEvidence,
    callLLM
  );

  const withResults = claimsWithEvidence.filter((c) => c.searchResults.length > 0).length;

  return {
    ok: true,
    claims,
    meta: buildMeta(extractResult, pageUnderstanding, {
      claimCount: claimItems.length,
      withResults,
      verifiedCount: claims.length,
    }),
  };
}

function buildMeta(extractResult, pageUnderstanding, stats) {
  return {
    url: extractResult.url,
    title: extractResult.title,
    mode: extractResult.mode,
    charCount: extractResult.text.length,
    claimCount: stats.claimCount,
    claimsWithSearchResults: stats.withResults,
    verifiedCount: stats.verifiedCount || 0,
    pageSummary: pageUnderstanding?.summary || "",
    timeSensitivity: pageUnderstanding?.timeSensitivity || "recent",
    searchEngine: "ClaimCheck Agent (Google News + Bing News + Web)",
  };
}

async function understandPage(provider, apiKey, pageText, pageUrl, pageTitle) {
  try {
    const parsed = await callLLM(provider, apiKey, {
      system: CONTEXT_SYSTEM_PROMPT,
      user: buildContextPrompt(pageText, pageUrl, pageTitle),
    });

    return {
      summary: String(parsed?.summary || "").trim(),
      domain: String(parsed?.domain || "other").trim(),
      timeSensitivity: String(parsed?.timeSensitivity || "recent").trim(),
      sourceType: String(parsed?.sourceType || "other").trim(),
      entities: Array.isArray(parsed?.entities)
        ? parsed.entities.map((e) => String(e).trim()).filter(Boolean)
        : [],
      topics: Array.isArray(parsed?.topics)
        ? parsed.topics.map((t) => String(t).trim()).filter(Boolean)
        : [],
      searchStrategy: String(parsed?.searchStrategy || "").trim(),
      language: String(parsed?.language || "other").trim(),
    };
  } catch (_) {
    return {
      summary: "",
      domain: "other",
      timeSensitivity: "recent",
      sourceType: "other",
      entities: [],
      topics: [],
      searchStrategy: "",
      language: "other",
    };
  }
}

async function extractClaims(provider, apiKey, pageText, pageUrl, pageUnderstanding) {
  const parsed = await callLLM(provider, apiKey, {
    system: EXTRACT_SYSTEM_PROMPT,
    user: buildExtractPrompt(pageText, pageUrl, pageUnderstanding),
  });

  if (!Array.isArray(parsed?.claims)) return [];

  return parsed.claims
    .map((item) => {
      if (typeof item === "string") {
        return { claim: item.trim(), searchQuery: item.trim(), context: "", entities: [] };
      }
      const claim = String(item?.text || item?.claim || "").trim();
      const searchQuery = String(item?.searchQuery || claim).trim();
      const context = String(item?.context || "").trim();
      const entities = Array.isArray(item?.entities)
        ? item.entities.map((e) => String(e).trim()).filter(Boolean)
        : [];
      return { claim, searchQuery, context, entities };
    })
    .filter((item) => item.claim)
    .slice(0, MAX_CLAIMS_TO_VERIFY);
}

async function getTargetTab() {
  const lastFocused = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (lastFocused[0]?.id) return lastFocused[0];

  const current = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return current[0] || null;
}

function isRestrictedUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("devtools://") ||
    url.startsWith("chrome-search://")
  );
}

async function callLLM(provider, apiKey, { system, user }) {
  if (provider.id === "gemini") {
    return callGemini(apiKey, provider, system, user);
  }

  const body = {
    model: provider.model,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  if (provider.supportsJsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await readError(response);
    if (response.status === 401) {
      throw new Error(`API key inválida para ${provider.label}.`);
    }
    if (response.status === 429) {
      throw new Error(`Limite de uso da ${provider.label} atingido. Tente novamente em instantes.`);
    }
    throw new Error(detail || `Erro na ${provider.label} (HTTP ${response.status}).`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Resposta vazia do modelo.");
  }

  return parseJsonContent(content);
}

async function callGemini(apiKey, provider, system, user) {
  const url = `${provider.url}?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const detail = await readError(response);
    if (response.status === 401 || response.status === 403) {
      throw new Error("API key inválida para Gemini.");
    }
    throw new Error(detail || `Erro no Gemini (HTTP ${response.status}).`);
  }

  const data = await response.json();
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error("Resposta vazia do Gemini.");
  }

  return parseJsonContent(content);
}

async function readError(response) {
  try {
    const body = await response.json();
    return body?.error?.message || body?.message || "";
  } catch (_) {
    return "";
  }
}
