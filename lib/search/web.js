// Provedores de busca na web aberta. Todos devolvem { title, url, text, provider }.
import { fetchWithRetry, HttpError } from "../http.js";
import { stripTags } from "../evidence.js";

const WEB_TIMEOUT_MS = 10_000;

export async function searchBrave(query, { apiKey, limit = 6, fetchImpl, sleep } = {}) {
  if (!apiKey) throw new HttpError("Brave Search sem API key", { status: 401 });
  const params = new URLSearchParams({ q: query, count: String(limit), extra_snippets: "true" });
  const response = await fetchWithRetry(
    `https://api.search.brave.com/res/v1/web/search?${params}`,
    { headers: { Accept: "application/json", "X-Subscription-Token": apiKey } },
    { fetchImpl, sleep, timeoutMs: WEB_TIMEOUT_MS, retries: 1 }
  );
  const data = await response.json();
  return (data?.web?.results || []).slice(0, limit).map((r) => ({
    title: stripTags(r.title),
    url: r.url,
    text: [stripTags(r.description), ...(r.extra_snippets || []).map(stripTags)].filter(Boolean).join(" … "),
    provider: "brave",
  }));
}

export async function searchTavily(query, { apiKey, limit = 6, fetchImpl, sleep } = {}) {
  if (!apiKey) throw new HttpError("Tavily sem API key", { status: 401 });
  const response = await fetchWithRetry(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, max_results: limit, search_depth: "basic", include_answer: false }),
    },
    { fetchImpl, sleep, timeoutMs: WEB_TIMEOUT_MS, retries: 1 }
  );
  const data = await response.json();
  return (data?.results || []).slice(0, limit).map((r) => ({
    title: String(r.title || "").trim(),
    url: r.url,
    text: String(r.content || "").trim(),
    provider: "tavily",
  }));
}

/**
 * DuckDuckGo HTML. Não é API oficial: é scraping da versão sem JavaScript.
 * Se o layout mudar ou vier página de bloqueio, devolve lista vazia.
 */
export async function searchDuckDuckGo(query, { limit = 6, fetchImpl, sleep } = {}) {
  const response = await fetchWithRetry(
    `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query })}`,
    { headers: { Accept: "text/html" } },
    { fetchImpl, sleep, timeoutMs: WEB_TIMEOUT_MS, retries: 0 }
  );
  const html = await response.text();
  // HTTP 202 é a página de verificação anti-robô; não tentamos contornar, só avisamos.
  if (response.status === 202 || /anomaly-modal|challenge-form/i.test(html)) {
    throw new HttpError("bloqueado pelo DuckDuckGo (verificação anti-robô)", { status: 202 });
  }
  return parseDuckDuckGoHtml(html).slice(0, limit);
}

export function parseDuckDuckGoHtml(html) {
  const results = [];
  // split com grupo de captura: [antes, classe1, bloco1, classe2, bloco2, ...]
  const parts = String(html || "").split(/<div[^>]+class="([^"]*\bresult\b[^"]*)"/i);
  for (let i = 1; i < parts.length; i += 2) {
    const className = parts[i];
    const block = parts[i + 1] || "";
    if (/result--ad\b/.test(className)) continue;
    const link = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const url = decodeDuckDuckGoUrl(link[1]);
    if (!url) continue;
    const snippet = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    results.push({
      title: stripTags(link[2]),
      url,
      text: stripTags(snippet?.[1] || ""),
      provider: "duckduckgo",
    });
  }
  return results;
}

export function decodeDuckDuckGoUrl(href) {
  const raw = String(href || "").replace(/&amp;/g, "&");
  const match = raw.match(/[?&]uddg=([^&]+)/);
  const target = match ? safeDecode(match[1]) : raw;
  if (/^https?:\/\//.test(target) && !/duckduckgo\.com\/y\.js/.test(target)) return target;
  return "";
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return "";
  }
}
