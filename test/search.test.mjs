import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDuckDuckGoHtml, decodeDuckDuckGoUrl, searchBrave, searchTavily } from "../lib/search/web.js";
import { searchWikipedia } from "../lib/search/wikipedia.js";
import { gatherEvidence, guessLanguage } from "../lib/search/index.js";
import { mockFetch, noSleep, jsonResponse, textResponse } from "./helpers.mjs";

const ddgHtml = readFileSync(new URL("./fixtures/duckduckgo.html", import.meta.url), "utf8");

test("parseDuckDuckGoHtml extrai título, URL real e snippet, sem anúncios", () => {
  const results = parseDuckDuckGoHtml(ddgHtml);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    title: "Brasília - Wikipédia",
    url: "https://pt.wikipedia.org/wiki/Brasília",
    text: "A cidade foi inaugurada em 21 de abril de 1960 como nova capital.",
    provider: "duckduckgo",
  });
  assert.equal(results[1].url, "https://exemplo.com.br/historia?a=1&b=2");
  assert.equal(results[1].title, "História & capital");
});

test("parseDuckDuckGoHtml devolve vazio para página de bloqueio ou layout novo", () => {
  assert.deepEqual(parseDuckDuckGoHtml("<html><body>Unfortunately, bots use DuckDuckGo too.</body></html>"), []);
  assert.deepEqual(parseDuckDuckGoHtml(""), []);
});

test("decodeDuckDuckGoUrl recusa esquemas não http", () => {
  assert.equal(decodeDuckDuckGoUrl("javascript:alert(1)"), "");
  assert.equal(decodeDuckDuckGoUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com%2F"), "https://a.com/");
});

test("searchWikipedia junta snippet da busca e resumo da página", async () => {
  const fetchImpl = mockFetch([
    [
      /list=search/,
      () => jsonResponse({ query: { search: [{ title: "Berlin Wall", snippet: 'The <span class="searchmatch">wall</span> fell in 1989' }] } }),
    ],
    [/prop=extracts/, () => jsonResponse({ query: { pages: [{ title: "Berlin Wall", extract: "The Berlin Wall was a guarded concrete barrier." }] } })],
  ]);
  const out = await searchWikipedia("Berlin Wall 1989", { lang: "en", fetchImpl, sleep: noSleep });
  assert.equal(out.length, 1);
  assert.equal(out[0].url, "https://en.wikipedia.org/wiki/Berlin_Wall");
  assert.equal(out[0].text, "The wall fell in 1989 … The Berlin Wall was a guarded concrete barrier.");
  assert.equal(out[0].provider, "wikipedia-en");
  assert.ok(fetchImpl.calls[0].init.headers["Api-User-Agent"].startsWith("ClaimCheck"));
});

test("searchWikipedia tenta consulta mais curta quando não acha nada", async () => {
  const fetchImpl = mockFetch([
    [/list=search/, (url) => jsonResponse({ query: { search: url.includes("muito") ? [] : [{ title: "A", snippet: "a" }] } })],
    [/prop=extracts/, () => jsonResponse({ query: { pages: [] } })],
  ]);
  const out = await searchWikipedia("um dois três quatro muito longo", { lang: "pt", fetchImpl, sleep: noSleep });
  assert.equal(out.length, 1);
  assert.equal(fetchImpl.calls.filter((c) => c.url.includes("list=search")).length, 2);
});

test("searchBrave usa X-Subscription-Token e mapeia web.results", async () => {
  const fetchImpl = mockFetch([
    [
      /api\.search\.brave\.com/,
      () => jsonResponse({ web: { results: [{ title: "T <b>x</b>", url: "https://a.com", description: "desc", extra_snippets: ["mais"] }] } }),
    ],
  ]);
  const out = await searchBrave("q", { apiKey: "bk", fetchImpl, sleep: noSleep });
  assert.equal(fetchImpl.calls[0].init.headers["X-Subscription-Token"], "bk");
  assert.deepEqual(out, [{ title: "T x", url: "https://a.com", text: "desc … mais", provider: "brave" }]);
});

test("searchTavily faz POST com Bearer e mapeia results", async () => {
  const fetchImpl = mockFetch([[/api\.tavily\.com\/search/, () => jsonResponse({ results: [{ title: "T", url: "https://b.com", content: "c", score: 0.9 }] })]]);
  const out = await searchTavily("q", { apiKey: "tk", fetchImpl, sleep: noSleep });
  assert.equal(fetchImpl.calls[0].init.method, "POST");
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, "Bearer tk");
  assert.equal(fetchImpl.calls[0].body.query, "q");
  assert.deepEqual(out, [{ title: "T", url: "https://b.com", text: "c", provider: "tavily" }]);
});

test("guessLanguage diferencia PT e EN", () => {
  assert.equal(guessLanguage("O Brasil não ganhou a Copa de 2002 na Alemanha."), "pt");
  assert.equal(guessLanguage("The Berlin Wall fell in 1989 and was demolished."), "en");
});

test("gatherEvidence segue com a Wikipedia quando a busca web dá 429", async () => {
  const fetchImpl = mockFetch([
    [/list=search/, () => jsonResponse({ query: { search: [{ title: "Berlin Wall", snippet: "The Berlin Wall fell in 1989" }] } })],
    [/prop=extracts/, () => jsonResponse({ query: { pages: [{ title: "Berlin Wall", extract: "The Berlin Wall fell on 9 November 1989." }] } })],
    [/api\.search\.brave\.com/, () => jsonResponse({ message: "rate limited" }, 429)],
  ]);
  const out = await gatherEvidence({
    claim: "The Berlin Wall fell in 1989.",
    search: { provider: "brave", apiKey: "bk" },
    deps: { fetchImpl, sleep: noSleep },
  });
  assert.equal(out.evidence.length, 1);
  assert.equal(out.evidence[0].id, "E1");
  assert.equal(out.evidence[0].provider, "wikipedia-en");
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /brave: limite de requisições/);
});

test("gatherEvidence lê a página do melhor resultado web e anexa o trecho relevante", async () => {
  const page =
    "<html><nav>Menu</nav><p>Notícias de hoje sobre muitas coisas diferentes.</p><p>The Berlin Wall fell on 9 November 1989 after weeks of protests.</p></html>";
  const fetchImpl = mockFetch([
    [/wikipedia\.org/, () => jsonResponse({ query: { search: [] } })],
    [/html\.duckduckgo\.com/, () => textResponse(ddgLike("https://news.example.com/wall", "Berlin Wall fell", "The wall fell in 1989."))],
    [/news\.example\.com/, () => textResponse(page)],
  ]);
  const out = await gatherEvidence({
    claim: "The Berlin Wall fell in 1989.",
    search: { provider: "duckduckgo" },
    deps: { fetchImpl, sleep: noSleep },
  });
  assert.equal(out.evidence.length, 1);
  assert.equal(out.evidence[0].fetched, true);
  assert.ok(out.evidence[0].text.includes("9 November 1989"));
  assert.ok(!out.evidence[0].text.includes("Menu"));
});

test("bloqueio do DuckDuckGo (HTTP 202) vira aviso, não erro", async () => {
  const fetchImpl = mockFetch([
    [/wikipedia\.org/, () => jsonResponse({ query: { search: [] } })],
    [/html\.duckduckgo\.com/, () => textResponse("<html>verificação</html>", 202)],
  ]);
  const out = await gatherEvidence({ claim: "The Berlin Wall fell in 1989.", search: { provider: "duckduckgo" }, deps: { fetchImpl, sleep: noSleep } });
  assert.deepEqual(out.evidence, []);
  assert.match(out.warnings.join(" "), /duckduckgo: bloqueado/);
});

test("gatherEvidence não quebra quando tudo falha (timeout/rede)", async () => {
  const fetchImpl = async () => {
    throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
  };
  const out = await gatherEvidence({
    claim: "Qualquer afirmação sobre algo.",
    search: { provider: "duckduckgo" },
    deps: { fetchImpl, sleep: noSleep },
  });
  assert.deepEqual(out.evidence, []);
  assert.ok(out.warnings.length >= 2);
});

function ddgLike(url, title, snippet) {
  const enc = encodeURIComponent(url);
  return `<div class="result results_links web-result"><h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${enc}">${title}</a></h2><a class="result__snippet" href="#">${snippet}</a></div>`;
}
