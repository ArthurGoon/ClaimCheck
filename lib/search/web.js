// Provedores de busca na web aberta. Todos devolvem { title, url, text, provider }.
import { fetchWithRetry, HttpError } from "../http.js";
import { stripTags } from "../evidence.js";

const WEB_TIMEOUT_MS = 10_000;

export async function searchBrave(query, { apiKey, limit = 6, fetchImpl, sleep, signal } = {}) {
  if (!apiKey) throw new HttpError("Brave Search sem API key", { status: 401 });
  const params = new URLSearchParams({ q: query, count: String(limit), extra_snippets: "true" });
  const response = await fetchWithRetry(
    `https://api.search.brave.com/res/v1/web/search?${params}`,
    { headers: { Accept: "application/json", "X-Subscription-Token": apiKey } },
    { fetchImpl, sleep, signal, timeoutMs: WEB_TIMEOUT_MS, retries: 1 }
  );
  const data = await response.json();
  return (data?.web?.results || []).slice(0, limit).map((r) => ({
    title: stripTags(r.title),
    url: r.url,
    text: [stripTags(r.description), ...(r.extra_snippets || []).map(stripTags)].filter(Boolean).join(" … "),
    provider: "brave",
  }));
}

export async function searchTavily(query, { apiKey, limit = 6, fetchImpl, sleep, signal } = {}) {
  if (!apiKey) throw new HttpError("Tavily sem API key", { status: 401 });
  const response = await fetchWithRetry(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, max_results: limit, search_depth: "basic", include_answer: false }),
    },
    { fetchImpl, sleep, signal, timeoutMs: WEB_TIMEOUT_MS, retries: 1 }
  );
  const data = await response.json();
  return (data?.results || []).slice(0, limit).map((r) => ({
    title: String(r.title || "").trim(),
    url: r.url,
    text: String(r.content || "").trim(),
    provider: "tavily",
  }));
}
