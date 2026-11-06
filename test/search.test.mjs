import { test } from "node:test";
import assert from "node:assert/strict";
import { searchBrave, searchTavily } from "../lib/search/web.js";
import { searchWikipedia } from "../lib/search/wikipedia.js";
import { gatherEvidence, guessLanguage } from "../lib/search/index.js";
import { mockFetch, noSleep, jsonResponse, textResponse } from "./helpers.mjs";

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
  assert.match(out.warnings[0], /Brave: o limite de buscas/);
});

test("gatherEvidence lê a página do melhor resultado web e anexa o trecho relevante", async () => {
  const page =
    "<html><nav>Menu</nav><p>Notícias de hoje sobre muitas coisas diferentes.</p><p>The Berlin Wall fell on 9 November 1989 after weeks of protests.</p></html>";
  const fetchImpl = mockFetch([
    [/wikipedia\.org/, () => jsonResponse({ query: { search: [] } })],
    [/api\.tavily\.com/, () => jsonResponse({ results: [{ title: "Berlin Wall fell", url: "https://news.example.com/wall", content: "The wall fell in 1989." }] })],
    [/news\.example\.com/, () => textResponse(page)],
  ]);
  const out = await gatherEvidence({
    claim: "The Berlin Wall fell in 1989.",
    search: { provider: "tavily", apiKey: "tk" },
    deps: { fetchImpl, sleep: noSleep },
  });
  assert.equal(out.evidence.length, 1);
  assert.equal(out.evidence[0].fetched, true);
  assert.ok(out.evidence[0].text.includes("9 November 1989"));
  assert.ok(!out.evidence[0].text.includes("Menu"));
});

test("chave de busca recusada vira aviso legível, não erro", async () => {
  const fetchImpl = mockFetch([
    [/wikipedia\.org/, () => jsonResponse({ query: { search: [] } })],
    [/api\.tavily\.com/, () => jsonResponse({ detail: "invalid key" }, 401)],
  ]);
  const out = await gatherEvidence({ claim: "The Berlin Wall fell in 1989.", search: { provider: "tavily", apiKey: "x" }, deps: { fetchImpl, sleep: noSleep } });
  assert.deepEqual(out.evidence, []);
  assert.deepEqual(out.warnings, ["Tavily: a chave foi recusada"]);
});

test("claim em espanhol também consulta a Wikipedia ES", async () => {
  const fetchImpl = mockFetch([[/wikipedia\.org/, () => jsonResponse({ query: { search: [] } })]]);
  await gatherEvidence({ claim: "El Muro de Berlín cayó en 1989.", lang: "es", search: { provider: "wikipedia" }, deps: { fetchImpl, sleep: noSleep } });
  assert.ok(fetchImpl.calls.some((c) => c.url.startsWith("https://es.wikipedia.org/")));
  assert.ok(fetchImpl.calls.some((c) => c.url.startsWith("https://en.wikipedia.org/")));
});

test("cancelamento interrompe a busca em vez de virar aviso", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchImpl = mockFetch([[/wikipedia\.org/, () => jsonResponse({ query: { search: [] } })]]);
  await assert.rejects(
    gatherEvidence({ claim: "The Berlin Wall fell in 1989.", search: {}, deps: { fetchImpl, sleep: noSleep, signal: controller.signal } }),
    (err) => err.name === "AbortedError"
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test("gatherEvidence não quebra quando tudo falha (timeout/rede)", async () => {
  const fetchImpl = async () => {
    throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
  };
  const out = await gatherEvidence({
    claim: "Qualquer afirmação sobre algo.",
    search: { provider: "brave", apiKey: "bk" },
    deps: { fetchImpl, sleep: noSleep },
  });
  assert.deepEqual(out.evidence, []);
  assert.ok(out.warnings.length >= 2);
});

test("a própria página checada não entra como evidência", async () => {
  const fetchImpl = mockFetch([
    [
      /list=search/,
      () => jsonResponse({ query: { search: [{ title: "Brasília", snippet: "Brasília foi inaugurada em 1960" }, { title: "Juscelino Kubitschek", snippet: "inaugurou Brasília em 1960" }] } }),
    ],
    [/prop=extracts/, () => jsonResponse({ query: { pages: [] } })],
  ]);
  const out = await gatherEvidence({
    claim: "Brasília foi inaugurada em 1960.",
    lang: "pt",
    search: { provider: "wikipedia" },
    excludeUrls: ["https://pt.m.wikipedia.org/wiki/Bras%C3%ADlia#Hist%C3%B3ria"],
    deps: { fetchImpl, sleep: noSleep },
  });
  assert.ok(out.evidence.length > 0);
  const urls = out.evidence.map((e) => e.url);
  assert.ok(!urls.includes("https://pt.wikipedia.org/wiki/Bras%C3%ADlia"), urls.join(" "));
  assert.ok(urls.includes("https://en.wikipedia.org/wiki/Bras%C3%ADlia"), "outra edição da Wikipedia continua valendo");
});
