import { test } from "node:test";
import assert from "node:assert/strict";
import { checkClaim, checkPage, mapWithConcurrency } from "../lib/pipeline.js";
import { mockFetch, noSleep, jsonResponse, chatCompletion } from "./helpers.mjs";

const settings = { llmProvider: "openai", llmApiKey: "k", llmModel: "", searchProvider: "none", searchApiKey: "", maxClaims: 3 };

function wikiRoutes() {
  return [
    [/list=search/, () => jsonResponse({ query: { search: [{ title: "Berlin Wall", snippet: "The Berlin Wall fell in 1989" }] } })],
    [/prop=extracts/, () => jsonResponse({ query: { pages: [{ title: "Berlin Wall", extract: "The Berlin Wall fell on 9 November 1989." }] } })],
  ];
}

test("checkClaim: busca, pede veredito e devolve citações reais", async () => {
  const fetchImpl = mockFetch([
    ...wikiRoutes(),
    [
      /api\.openai\.com/,
      () => chatCompletion(JSON.stringify({ verdict: "refuted", confidence: 0.92, explanation: "Caiu em 1989.", citations: ["E1"] })),
    ],
  ]);
  const out = await checkClaim({ claim: "The Berlin Wall fell in 1991.", settings, deps: { fetchImpl, sleep: noSleep } });
  assert.equal(out.verdict, "refuted");
  assert.equal(out.citations[0].url, "https://en.wikipedia.org/wiki/Berlin_Wall");
  assert.equal(out.evidence.length, 1);

  const llmCall = fetchImpl.calls.find((c) => c.url.includes("openai"));
  assert.equal(llmCall.body.model, "gpt-6-luna");
  assert.ok(llmCall.body.messages[1].content.includes("[E1] Berlin Wall"));
});

test("checkClaim sem evidência não chama o LLM", async () => {
  const fetchImpl = mockFetch([[/wikipedia\.org/, () => jsonResponse({ query: { search: [] } })]]);
  const out = await checkClaim({ claim: "Algo totalmente obscuro aconteceu ontem.", settings, deps: { fetchImpl, sleep: noSleep } });
  assert.equal(out.verdict, "not_enough_evidence");
  assert.ok(!fetchImpl.calls.some((c) => c.url.includes("openai")));
});

test("checkPage: extrai claims e verifica cada um; erro em um claim não derruba os outros", async () => {
  const extraction = {
    page_summary: "Página sobre o Muro de Berlim.",
    language: "en",
    claims: [
      { text: "The Berlin Wall fell in 1989.", context: "Berlin Wall", search_query: "Berlin Wall fall 1989" },
      { text: "The Berlin Wall was built in 1961.", context: "Berlin Wall", search_query: "Berlin Wall built 1961" },
    ],
  };
  let verifyCalls = 0;
  const fetchImpl = mockFetch([
    ...wikiRoutes(),
    [
      /api\.openai\.com/,
      (_u, init) => {
        const body = JSON.parse(init.body);
        if (body.response_format.json_schema.name === "claims") return chatCompletion(JSON.stringify(extraction));
        verifyCalls += 1;
        if (body.messages[1].content.includes("1961")) return jsonResponse({ error: { message: "boom" } }, 400);
        return chatCompletion(JSON.stringify({ verdict: "supported", confidence: 0.9, explanation: "ok", citations: ["E1"] }));
      },
    ],
  ]);
  const progress = [];
  const report = await checkPage({
    page: { text: "texto", url: "https://x.com", title: "Muro" },
    settings,
    deps: { fetchImpl, sleep: noSleep },
    onProgress: (p) => progress.push(p.step),
  });
  assert.equal(report.pageSummary, "Página sobre o Muro de Berlim.");
  assert.equal(report.results.length, 2);
  assert.equal(report.results[0].verdict, "supported");
  assert.equal(report.results[1].verdict, "error");
  assert.equal(verifyCalls, 2);
  assert.equal(progress[0], "extract");
  assert.ok(progress.includes("verify"));
});

test("mapWithConcurrency preserva a ordem e respeita o limite", async () => {
  let running = 0;
  let peak = 0;
  const out = await mapWithConcurrency([30, 10, 20, 5], 2, async (ms, i) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, ms));
    running -= 1;
    return i;
  });
  assert.deepEqual(out, [0, 1, 2, 3]);
  assert.equal(peak, 2);
});
