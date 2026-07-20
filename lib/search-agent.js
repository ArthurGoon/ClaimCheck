const MAX_RESULTS = 8;
const MAX_FETCH = 4;
const MAX_PAGE_CHARS = 4000;
const CURRENT_YEAR = new Date().getFullYear();
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NEWS_DOMAINS =
  /(reuters|apnews|bbc|cnn|nytimes|theguardian|bloomberg|techcrunch|theverge|wired|arstechnica|decrypt|msn\.com|straitstimes|ibtimes|politico|g1\.globo|uol\.com|folha|estadao)/i;

const STATIC_DOMAINS = /wikipedia\.org|britannica\.com|wikidata\.org/i;

const IRRELEVANT_HOMONYMS = [
  /\bgnss\b/i,
  /positioning user service/i,
  /\(film\)/i,
  /\bcoffee\b/i,
  /\bopus codec\b/i,
];

/**
 * Busca profunda orientada a notícias e fontes atuais.
 * Wikipedia só entra em claims atemporais.
 */
export async function investigateClaim({ claim, searchQuery, pageContext, pageUnderstanding }) {
  const ctx = buildSearchContext(pageContext, pageUnderstanding);
  const queries = buildSearchQueries(claim, searchQuery, ctx);
  const pool = [];
  const seen = new Set();

  const add = (items) => {
    for (const item of items) {
      const key = item.url || item.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      pool.push(item);
    }
  };

  const useNews = ctx.timeSensitivity !== "timeless";
  const useWiki = ctx.timeSensitivity === "timeless";

  for (const query of queries) {
    const tasks = [searchBingWeb(query)];

    if (useNews) {
      tasks.push(searchGoogleNews(query));
      tasks.push(searchBingNews(query));
    }

    if (useWiki) {
      tasks.push(searchWikipedia(query, "en"));
      tasks.push(searchWikipedia(query, "pt"));
    }

    const batches = await Promise.all(tasks);
    batches.forEach(add);

    if (pool.length >= MAX_RESULTS) break;
  }

  let ranked = rankResults(pool, claim, ctx).filter((r) => r._score > -30);

  if (ranked.length < 2 && useNews) {
    const retry = `${ctx.entityHint} ${claim} news ${CURRENT_YEAR}`.trim();
    add(await searchGoogleNews(retry));
    add(await searchBingNews(retry));
    ranked = rankResults(pool, claim, ctx).filter((r) => r._score > -30);
  }

  ranked = ranked.slice(0, MAX_RESULTS).map(({ _score, ...item }) => item);

  const enriched = [];
  for (const item of ranked.slice(0, MAX_FETCH)) {
    if (!item.url?.startsWith("http")) {
      enriched.push(item);
      continue;
    }
    const pageText = await fetchPageExcerpt(item.url);
    enriched.push({
      ...item,
      snippet: pageText || item.snippet,
      fetched: Boolean(pageText),
    });
  }

  const remaining = ranked.slice(MAX_FETCH).map((item) => ({ ...item, fetched: false }));
  return [...enriched, ...remaining];
}

export async function investigateClaims(claimItems, pageContext = {}, pageUnderstanding = {}) {
  const results = [];

  for (const item of claimItems) {
    const evidence = await investigateClaim({
      claim: item.claim,
      searchQuery: item.searchQuery || item.claim,
      pageContext: {
        ...pageContext,
        entities: [...(pageUnderstanding.entities || []), ...(item.entities || [])],
        claimContext: item.context || "",
      },
      pageUnderstanding,
    });

    results.push({
      claim: item.claim,
      searchQuery: item.searchQuery || item.claim,
      claimContext: item.context || "",
      pageSummary: pageUnderstanding.summary || "",
      searchResults: evidence,
    });
  }

  return results;
}

function buildSearchContext(pageContext, pageUnderstanding) {
  const entities = [
    ...(pageUnderstanding.entities || []),
    ...(pageContext.entities || []),
  ];
  const uniqueEntities = [...new Set(entities.map((e) => String(e).trim()).filter(Boolean))];

  return {
    summary: pageUnderstanding.summary || "",
    domain: pageUnderstanding.domain || "other",
    timeSensitivity: pageUnderstanding.timeSensitivity || "recent",
    searchStrategy: pageUnderstanding.searchStrategy || "",
    entities: uniqueEntities,
    entityHint: uniqueEntities.slice(0, 4).join(" "),
    topics: pageUnderstanding.topics || [],
    pageText: pageContext.pageText || "",
  };
}

function buildSearchQueries(claim, searchQuery, ctx) {
  const primary = String(searchQuery || claim || "").trim();
  const text = String(claim || "").trim();
  const queries = [];
  const year = String(CURRENT_YEAR);

  if (ctx.entityHint) {
    queries.push(`${ctx.entityHint} ${text}`.trim());
    queries.push(`${ctx.entityHint} ${primary}`.trim());
  }

  if (ctx.timeSensitivity !== "timeless") {
    queries.push(`${primary} news ${year}`);
    queries.push(`${primary} latest`);
    queries.push(`${ctx.entityHint} ${text} ${year}`.trim());
  }

  queries.push(primary);
  if (text !== primary) queries.push(text);

  if (ctx.searchStrategy) {
    queries.push(`${primary} ${ctx.searchStrategy}`.slice(0, 120));
  }

  return [...new Set(queries.filter((q) => q && q.length > 8))].slice(0, 5);
}

function rankResults(results, claim, ctx) {
  const terms = tokenize(claim);
  const contextTerms = [
    ...tokenize(ctx.summary),
    ...ctx.entities.map((e) => e.toLowerCase()),
    ...ctx.topics.map((t) => t.toLowerCase()),
  ];

  return results
    .map((item) => ({ ...item, _score: scoreItem(item, terms, contextTerms, ctx) }))
    .sort((a, b) => b._score - a._score);
}

function scoreItem(item, terms, contextTerms, ctx) {
  const hay = `${item.title} ${item.snippet} ${item.url}`.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (term.length > 2 && hay.includes(term)) score += 14;
  }
  for (const term of contextTerms) {
    if (term.length > 3 && hay.includes(term)) score += 20;
  }

  if (item.source === "google-news" || item.source === "bing-news") score += 35;
  if (NEWS_DOMAINS.test(item.url || "")) score += 30;
  if (item.source === "bing-web") score += 12;

  if (ctx.timeSensitivity !== "timeless" && STATIC_DOMAINS.test(item.url || "")) {
    score -= 40;
  }

  for (const bad of IRRELEVANT_HOMONYMS) {
    if (bad.test(`${item.title} ${item.snippet}`)) score -= 70;
  }

  if (/\b(anthropic|claude|parameters|trillion|ai model)\b/i.test(hay) && ctx.domain === "technology") {
    score += 20;
  }

  return score;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2);
}

async function searchGoogleNews(query) {
  const url = `https://news.google.com/rss/search?${new URLSearchParams({
    q: query,
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  })}`;

  const response = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "application/rss+xml" },
  });
  if (!response.ok) return [];

  const xml = await response.text();
  const results = [];
  const itemRegex = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/gi;

  let match;
  while ((match = itemRegex.exec(xml)) !== null && results.length < MAX_RESULTS) {
    const title = cleanXml(match[1]);
    const link = cleanXml(match[2]);
    if (title && link.startsWith("http")) {
      results.push({
        title,
        url: link,
        snippet: title,
        source: "google-news",
      });
    }
  }

  return results;
}

async function searchBingNews(query) {
  const url = `https://www.bing.com/news/search?${new URLSearchParams({
    q: query,
    setlang: "en-us",
    cc: "us",
  })}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) return [];

  const html = (await response.text()).replace(/&amp;/g, "&");
  const results = [];
  const regex =
    /<a[^>]*class="[^"]*title[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  while ((match = regex.exec(html)) !== null && results.length < MAX_RESULTS) {
    const rawUrl = match[1];
    const title = stripHtml(match[2]);
    const resultUrl = rawUrl.startsWith("http") ? rawUrl : decodeBingRedirect(rawUrl);
    if (title && resultUrl?.startsWith("http")) {
      results.push({ title, url: resultUrl, snippet: title, source: "bing-news" });
    }
  }

  return results;
}

async function searchBingWeb(query) {
  const url = `https://www.bing.com/search?${new URLSearchParams({
    q: query,
    setlang: "en-us",
    cc: "us",
  })}`;

  const response = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
  });
  if (!response.ok) return [];

  const html = (await response.text()).replace(/&amp;/g, "&");
  const blocks = html.split(/<li class="b_algo"/i).slice(1);
  const results = [];

  for (const block of blocks.slice(0, MAX_RESULTS)) {
    const titleMatch = block.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    const title = stripHtml(titleMatch?.[1] || "");
    if (!title) continue;

    let resultUrl = "";
    const hrefMatch = block.match(/href="(https:\/\/www\.bing\.com\/ck\/a[^"]+)"/i);
    if (hrefMatch) resultUrl = decodeBingRedirect(hrefMatch[1]) || "";

    const citeMatch = block.match(/<cite[^>]*>([^<]+)/i);
    if (!resultUrl && citeMatch) {
      const cite = citeMatch[1].trim().replace(/^https?:\/\//, "");
      resultUrl = cite.startsWith("http") ? cite : `https://${cite.split(" ")[0]}`;
    }

    const snippetMatch = block.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = stripHtml(snippetMatch?.[1] || "");

    if (resultUrl.startsWith("http")) {
      results.push({ title, url: resultUrl, snippet, source: "bing-web" });
    }
  }

  return results;
}

async function searchWikipedia(query, lang) {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    format: "json",
    origin: "*",
    srlimit: "2",
    utf8: "1",
  });

  const response = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
    headers: { "User-Agent": BROWSER_UA },
  });
  if (!response.ok) return [];

  const data = await response.json();
  const items = Array.isArray(data?.query?.search) ? data.query.search : [];

  return items.map((item) => ({
    title: `${item.title} (Wikipedia ${lang.toUpperCase()})`,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
    snippet: stripHtml(item.snippet || ""),
    source: `wikipedia-${lang}`,
  }));
}

function decodeBingRedirect(href) {
  const match = href.match(/[?&]u=([^&]+)/i);
  if (!match) return "";
  let encoded = decodeURIComponent(match[1]);
  if (encoded.startsWith("a1")) encoded = encoded.slice(2);
  try {
    const decoded = globalThis.atob(encoded);
    if (decoded.startsWith("http")) return decoded;
  } catch (_) {
    /* ignore */
  }
  return "";
}

async function fetchPageExcerpt(url) {
  if (STATIC_DOMAINS.test(url)) return "";

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return "";

    const html = await response.text();
    const text = stripHtml(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    );

    return text.slice(0, MAX_PAGE_CHARS);
  } catch (_) {
    return "";
  }
}

function cleanXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .trim();
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
