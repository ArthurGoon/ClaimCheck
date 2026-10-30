import { test } from "node:test";
import assert from "node:assert/strict";
import { callLLM, completeJSON, toGeminiSchema, LLMError } from "../lib/llm.js";
import { VERDICT_SCHEMA } from "../lib/schemas.js";
import { normalizeVerdictPayload } from "../lib/verify.js";
import { mockFetch, noSleep, jsonResponse, chatCompletion, anthropicMessage, geminiResponse } from "./helpers.mjs";

const VALID = JSON.stringify({ verdict: "supported", confidence: 0.8, explanation: "ok", citations: ["E1"] });
const base = { model: "m", apiKey: "k", system: "sys", user: "usr", schema: VERDICT_SCHEMA, schemaName: "verdict", sleep: noSleep };

test("OpenAI: usa json_schema strict e Bearer", async () => {
  const fetchImpl = mockFetch([[/api\.openai\.com/, () => chatCompletion(VALID)]]);
  const text = await callLLM({ ...base, provider: "openai", fetchImpl });
  assert.equal(text, VALID);
  const call = fetchImpl.calls[0];
  assert.equal(call.init.headers.Authorization, "Bearer k");
  assert.equal(call.body.response_format.type, "json_schema");
  assert.equal(call.body.response_format.json_schema.strict, true);
  assert.deepEqual(call.body.response_format.json_schema.schema, VERDICT_SCHEMA);
  assert.equal(call.body.messages[0].content, "sys");
});

test("OpenAI: se o schema for recusado com 400, repete com json_object e schema no prompt", async () => {
  const fetchImpl = mockFetch([
    [
      /api\.openai\.com/,
      (_url, init) => {
        const body = JSON.parse(init.body);
        if (body.response_format.type === "json_schema") {
          return jsonResponse({ error: { message: "Invalid parameter: response_format json_schema not supported" } }, 400);
        }
        return chatCompletion(VALID);
      },
    ],
  ]);
  const text = await callLLM({ ...base, provider: "openai", fetchImpl });
  assert.equal(text, VALID);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[1].body.response_format.type, "json_object");
  assert.ok(fetchImpl.calls[1].body.messages[0].content.includes("JSON Schema"));
});

test("DeepSeek: JSON mode com schema descrito no prompt", async () => {
  const fetchImpl = mockFetch([[/api\.deepseek\.com\/chat\/completions/, () => chatCompletion(VALID)]]);
  await callLLM({ ...base, provider: "deepseek", fetchImpl });
  const body = fetchImpl.calls[0].body;
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.ok(body.messages[0].content.includes('"verdict"'));
});

test("Anthropic: headers de browser, output_config e só blocos de texto", async () => {
  const fetchImpl = mockFetch([[/api\.anthropic\.com\/v1\/messages/, () => anthropicMessage(VALID)]]);
  const text = await callLLM({ ...base, provider: "anthropic", model: "claude-haiku-5-5", fetchImpl });
  assert.equal(text, VALID);
  const { init, body } = fetchImpl.calls[0];
  assert.equal(init.headers["x-api-key"], "k");
  assert.equal(init.headers["anthropic-version"], "2023-06-01");
  assert.equal(init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(body.model, "claude-haiku-5-5");
  assert.deepEqual(body.output_config, { format: { type: "json_schema", schema: VERDICT_SCHEMA } });
  assert.equal(body.system, "sys");
  assert.equal(body.temperature, undefined, "Haiku 5.5 recusa temperature fora do padrão");
});

test("Gemini: chave no header, responseSchema sem additionalProperties, ignora partes de raciocínio", async () => {
  const fetchImpl = mockFetch([[/generativelanguage\.googleapis\.com/, () => geminiResponse(VALID)]]);
  const text = await callLLM({ ...base, provider: "gemini", model: "gemini-3.8-flash", fetchImpl });
  assert.equal(text, VALID);
  const { url, init, body } = fetchImpl.calls[0];
  assert.ok(url.endsWith("/models/gemini-3.8-flash:generateContent"));
  assert.ok(!url.includes("key="), "a chave não vai na URL");
  assert.equal(init.headers["x-goog-api-key"], "k");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.ok(!JSON.stringify(body.generationConfig.responseSchema).includes("additionalProperties"));
});

test("toGeminiSchema preserva o resto do schema", () => {
  const out = toGeminiSchema(VERDICT_SCHEMA);
  assert.deepEqual(out.required, VERDICT_SCHEMA.required);
  assert.deepEqual(out.properties.verdict.enum, VERDICT_SCHEMA.properties.verdict.enum);
});

test("completeJSON tenta de novo quando a primeira resposta é inválida", async () => {
  const fetchImpl = mockFetch([
    [/api\.openai\.com/, (_u, _i, n) => (n === 0 ? chatCompletion("Claro! O veredito é verdadeiro.") : chatCompletion(VALID))],
  ]);
  const out = await completeJSON({ ...base, provider: "openai", fetchImpl, normalize: normalizeVerdictPayload });
  assert.equal(out.verdict, "supported");
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(fetchImpl.calls[1].body.messages[1].content.includes("previous answer was rejected"));
});

test("completeJSON corrige sinônimos via normalize sem precisar de retry", async () => {
  const loose = JSON.stringify({ verdict: "false", confidence: 90, explanation: "x", citations: ["E1"] });
  const fetchImpl = mockFetch([[/api\.deepseek\.com/, () => chatCompletion(loose)]]);
  const out = await completeJSON({ ...base, provider: "deepseek", fetchImpl, normalize: normalizeVerdictPayload });
  assert.equal(out.verdict, "refuted");
  assert.equal(out.confidence, 0.9);
  assert.equal(fetchImpl.calls.length, 1);
});

test("completeJSON desiste depois do limite de tentativas", async () => {
  const fetchImpl = mockFetch([[/api\.openai\.com/, () => chatCompletion('{"verdict": "talvez"}')]]);
  await assert.rejects(
    completeJSON({ ...base, provider: "openai", fetchImpl, normalize: normalizeVerdictPayload }),
    (err) => err instanceof LLMError && /formato esperado/.test(err.message)
  );
  assert.equal(fetchImpl.calls.length, 2);
});

test("resposta cortada (max_tokens) conta como malformada e é repetida", async () => {
  const fetchImpl = mockFetch([
    [/api\.anthropic\.com/, (_u, _i, n) => (n === 0 ? anthropicMessage('{"verdict": "sup', "max_tokens") : anthropicMessage(VALID))],
  ]);
  const out = await completeJSON({ ...base, provider: "anthropic", fetchImpl });
  assert.equal(out.verdict, "supported");
});

test("429 é repetido respeitando Retry-After e depois funciona", async () => {
  const waits = [];
  const fetchImpl = mockFetch([
    [
      /api\.openai\.com/,
      (_u, _i, n) => (n === 0 ? jsonResponse({ error: { message: "rate" } }, 429, { "retry-after": "2" }) : chatCompletion(VALID)),
    ],
  ]);
  await callLLM({ ...base, provider: "openai", fetchImpl, sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(waits, [2000]);
});

test("erros HTTP viram mensagens claras", async () => {
  const cases = [
    [401, /API key recusada/],
    [404, /Modelo não encontrado/],
    [429, /Limite de uso/],
  ];
  for (const [status, pattern] of cases) {
    const fetchImpl = mockFetch([[/api\.openai\.com/, () => jsonResponse({ error: { message: "x" } }, status)]]);
    await assert.rejects(callLLM({ ...base, provider: "openai", fetchImpl }), (err) => err instanceof LLMError && pattern.test(err.message));
  }
});

test("sem API key falha antes de qualquer requisição", async () => {
  const fetchImpl = mockFetch([]);
  await assert.rejects(callLLM({ ...base, apiKey: "", provider: "openai", fetchImpl }), LLMError);
  assert.equal(fetchImpl.calls.length, 0);
});
