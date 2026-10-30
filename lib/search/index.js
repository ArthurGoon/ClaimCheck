// Agente de busca: consulta Wikipedia (sempre) e um provedor web plugável,
// ranqueia, lê as melhores páginas e devolve evidências numeradas (E1, E2, ...).
// Falha de um provedor vira aviso, nunca derruba a verificação.

import { fetchWithRetry } from "../http.js";
import { keywordQuery, rankEvidence, selectPassages, htmlToText } from "../evidence.js";
import { searchWikipedia } from "./wikipedia.js";
import { searchBrave, searchTavily, searchDuckDuckGo } from "./web.js";

const WEB_SEARCHERS = {
  brave: searchBrave,
  tavily: searchTavily,
  duckduckgo: searchDuckDuckGo,
};

const MAX_EVIDENCE = 6;
const PAGES_TO_READ = 2;
const EVIDENCE_CHARS = 1200;
const PAGE_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1_500_000;

export function guessLanguage(text) {
  const value = ` ${String(text || "").toLowerCase()} `;
  const pt = (value.match(/[ãõçáéíóúâêô]| não | é | de | do | da | em | que | foi | os | as /g) || []).length;
  const en = (value.match(/ the | is | was | of | and | in | on | which | were /g) || []).length;
  return pt > en ? "pt" : "en";
}

/**
 * @param {object} p
 * @param {string} p.claim               texto do claim
 * @param {string} [p.searchQuery]       consulta sugerida pelo LLM (em inglês)
 * @param {string} [p.lang]              idioma do claim (pt, en, ...)
 * @param {object} p.search              { provider, apiKey }
 * @param {object} [p.deps]              { fetchImpl, sleep } para testes e Node
 */
export async function gatherEvidence({ claim, searchQuery = "", lang, search = {}, deps = {} }) {
  const language = lang || guessLanguage(claim);
  const keywords = keywordQuery(claim);
  const englishQuery = searchQuery || keywords;
  const warnings = [];
  const tasks = [];

  tasks.push(["wikipedia-en", () => searchWikipedia(language === "en" ? keywords : englishQuery, { lang: "en", ...deps })]);
  if (language === "pt") tasks.push(["wikipedia-pt", () => searchWikipedia(keywords, { lang: "pt", ...deps })]);

  const providerId = search.provider || "none";
  const webSearch = WEB_SEARCHERS[providerId];
  if (webSearch) {
    // O claim já vem autocontido (nomes completos), então serve como consulta web.
    tasks.push([providerId, () => webSearch(claim, { apiKey: search.apiKey, ...deps })]);
  }

  const settled = await Promise.allSettled(tasks.map(([, run]) => run()));
  const pool = [];
  const providerStats = {};
  settled.forEach((outcome, i) => {
    const name = tasks[i][0];
    if (outcome.status === "fulfilled") {
      pool.push(...outcome.value);
      providerStats[name] = outcome.value.length;
    } else {
      providerStats[name] = `erro: ${outcome.reason?.message || outcome.reason}`;
      warnings.push(`${name}: ${describeFailure(outcome.reason)}`);
    }
  });

  const rankingText = `${claim} ${searchQuery}`;
  const ranked = rankEvidence(pool, rankingText, { limit: MAX_EVIDENCE });

  // Lê as melhores páginas que não são Wikipedia (essas já vêm com o resumo da API).
  const toRead = ranked.filter((r) => !r.provider.startsWith("wikipedia")).slice(0, PAGES_TO_READ);
  await Promise.all(
    toRead.map(async (item) => {
      const pageText = await readPage(item.url, deps);
      const passages = pageText ? selectPassages(pageText, rankingText, EVIDENCE_CHARS) : "";
      if (passages) {
        item.text = item.text ? `${item.text} … ${passages}` : passages;
        item.fetched = true;
      }
    })
  );

  const evidence = ranked.map((item, index) => ({
    id: `E${index + 1}`,
    title: item.title || item.domain,
    url: item.url,
    domain: item.domain,
    provider: item.provider,
    text: String(item.text || "").slice(0, EVIDENCE_CHARS + 400),
    score: item.score,
    fetched: Boolean(item.fetched),
  }));

  return { evidence, warnings, stats: { providers: providerStats, candidates: pool.length } };
}

/** Baixa a página e devolve o texto, ou "" em qualquer falha (timeout, PDF, bloqueio). */
export async function readPage(url, { fetchImpl, sleep } = {}) {
  try {
    const response = await fetchWithRetry(
      url,
      { headers: { Accept: "text/html,application/xhtml+xml" }, redirect: "follow" },
      { fetchImpl, sleep, timeoutMs: PAGE_TIMEOUT_MS, retries: 0 }
    );
    const type = response.headers?.get?.("content-type") || "";
    if (type && !/html|text\/plain/i.test(type)) return "";
    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    return htmlToText(html);
  } catch (_) {
    return "";
  }
}

function describeFailure(err) {
  const status = err?.status;
  if (status === 401 || status === 403) return "chave recusada ou ausente";
  if (status === 429) return "limite de requisições atingido";
  if (status === 202) return "bloqueado pelo buscador (verificação anti-robô); configure Brave ou Tavily";
  if (status === 0) return err.message;
  return err?.message || "falhou";
}
