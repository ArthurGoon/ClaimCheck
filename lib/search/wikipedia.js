// Wikipedia via API oficial (MediaWiki Action API): busca + resumo da página.
import { fetchWithRetry } from "../http.js";
import { stripTags } from "../evidence.js";

const USER_AGENT = "ClaimCheck/1.0 (https://github.com/ArthurGoon/ClaimCheck)";

export async function searchWikipedia(query, { lang = "en", limit = 3, fetchImpl, sleep, timeoutMs = 10_000 } = {}) {
  const base = `https://${lang}.wikipedia.org/w/api.php`;
  const http = { fetchImpl, sleep, timeoutMs, retries: 1 };
  // A Wikipedia pede um User-Agent identificável. No navegador o header User-Agent
  // não pode ser trocado, então mandamos também o Api-User-Agent.
  const headers = { "Api-User-Agent": USER_AGENT, "User-Agent": USER_AGENT };

  let hits = await runSearch(base, query, limit, headers, http);
  if (!hits.length) {
    const shorter = query.split(/\s+/).slice(0, 4).join(" ");
    if (shorter !== query) hits = await runSearch(base, shorter, limit, headers, http);
  }
  if (!hits.length) return [];

  const extracts = await fetchIntros(base, hits.map((h) => h.title), headers, http);

  return hits.map((hit) => {
    const intro = extracts.get(hit.title) || "";
    const snippet = stripTags(hit.snippet);
    const text = [snippet, intro].filter(Boolean).join(" … ").slice(0, 1500);
    return {
      title: `${hit.title} (Wikipedia ${lang.toUpperCase()})`,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
      text,
      provider: `wikipedia-${lang}`,
    };
  });
}

async function runSearch(base, query, limit, headers, http) {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: String(limit),
    srprop: "snippet",
    format: "json",
    formatversion: "2",
    origin: "*",
  });
  const response = await fetchWithRetry(`${base}?${params}`, { headers }, http);
  const data = await response.json();
  return Array.isArray(data?.query?.search) ? data.query.search : [];
}

async function fetchIntros(base, titles, headers, http) {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts",
    exintro: "1",
    explaintext: "1",
    exlimit: String(titles.length),
    titles: titles.join("|"),
    redirects: "1",
    format: "json",
    formatversion: "2",
    origin: "*",
  });
  const map = new Map();
  try {
    const response = await fetchWithRetry(`${base}?${params}`, { headers }, http);
    const data = await response.json();
    for (const page of data?.query?.pages || []) {
      if (page?.title && page.extract) map.set(page.title, page.extract.replace(/\s+/g, " ").trim().slice(0, 1200));
    }
  } catch (_) {
    // Sem resumo seguimos só com o snippet da busca.
  }
  return map;
}
