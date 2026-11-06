import { test } from "node:test";
import assert from "node:assert/strict";
import { callLLM, LLMError } from "../lib/llm.js";
import { mockVerdict } from "../lib/mock-llm.js";
import { LLM_PROVIDERS } from "../lib/providers.js";
import { checkPage } from "../lib/pipeline.js";
import { mockFetch, noSleep, jsonResponse } from "./helpers.mjs";

test("modelo simulado não aparece entre os provedores do usuário", () => {
  assert.equal(LLM_PROVIDERS.mock, undefined);
});

test("veredito simulado só cita ids que existem no prompt", () => {
  const user = "Claim: O muro caiu em 1989.\n\nEvidence:\n[E1] Muro\nSource: x\nExcerpt: ...\n\n[E2] Outro\nSource: y\nExcerpt: ...";
  const script = { verdicts: [{ match: "caiu em 1989", verdict: "supported", confidence: 0.9, explanation: "ok", citations: ["E2", "E7"] }] };
  assert.deepEqual(mockVerdict(script, user).citations, ["E2"]);

  const semCitacao = { verdicts: [{ match: "1989", verdict: "refuted", confidence: 0.8, explanation: "x", citations: ["E9"] }] };
  assert.deepEqual(mockVerdict(semCitacao, user).citations, ["E1"]);
});

test("erro simulado passa pelo mesmo tratamento de erro dos provedores reais", async () => {
  await assert.rejects(
    callLLM({ provider: "mock", mockScript: { delayMs: 0, error: { status: 401 } }, system: "s", user: "u", schema: { type: "object" }, schemaName: "claims" }),
    (err) => err instanceof LLMError && err.code === "BAD_KEY"
  );
});

test("cancelar durante a espera do modelo simulado aborta o pipeline", async () => {
  const controller = new AbortController();
  const fetchImpl = mockFetch([[/wikipedia/, () => jsonResponse({ query: { search: [] } })]]);
  const settings = { llmProvider: "mock", llmApiKey: "mock", searchProvider: "wikipedia", maxClaims: 3, mockScript: { delayMs: 1000 } };
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(
    checkPage({ page: { text: "texto", url: "https://x.com", title: "x" }, settings, deps: { fetchImpl, sleep: noSleep, signal: controller.signal } }),
    (err) => err.name === "AbortedError"
  );
});

test("veredito simulado pode citar pelo título da fonte", () => {
  const user = "Claim: X caiu.\n\nEvidence:\n[E1] Outra coisa (Wikipedia PT)\nSource: a\n\n[E2] Berlin Wall (Wikipedia EN)\nSource: b";
  const script = { verdicts: [{ match: "caiu", verdict: "supported", confidence: 0.9, explanation: "ok", cite: ["Berlin Wall"] }] };
  assert.deepEqual(mockVerdict(script, user).citations, ["E2"]);
});
