import { test } from "node:test";
import assert from "node:assert/strict";
import { callLLM, completeJSON, testConnection, toGeminiSchema, LLMError } from "../lib/llm.js";
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

test("OpenRouter: endpoint OpenAI-compatível, json_schema, require_parameters e headers de atribuição", async () => {
  const fetchImpl = mockFetch([[/openrouter\.ai\/api\/v1\/chat\/completions/, () => chatCompletion(VALID)]]);
  const text = await callLLM({ ...base, provider: "openrouter", model: "openai/gpt-6-luna", fetchImpl });
  assert.equal(text, VALID);
  const { init, body } = fetchImpl.calls[0];
  assert.equal(init.headers.Authorization, "Bearer k");
  assert.equal(init.headers["HTTP-Referer"], "https://github.com/ArthurGoon/ClaimCheck");
  assert.equal(init.headers["X-Title"], "ClaimCheck");
  assert.equal(body.model, "openai/gpt-6-luna");
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.provider, { require_parameters: true });
});

test("OpenRouter: modelo sem structured output (404 de roteamento) cai para JSON pelo prompt", async () => {
  const fetchImpl = mockFetch([
    [
      /openrouter\.ai/,
      (_url, init) => {
        const body = JSON.parse(init.body);
        if (body.response_format.type === "json_schema") {
          return jsonResponse({ error: { code: 404, message: "No endpoints found that can handle the requested parameters." } }, 404);
        }
        return chatCompletion(VALID);
      },
    ],
  ]);
  const text = await callLLM({ ...base, provider: "openrouter", fetchImpl });
  assert.equal(text, VALID);
  const retry = fetchImpl.calls[1].body;
  assert.deepEqual(retry.response_format, { type: "json_object" });
  assert.equal(retry.provider, undefined);
  assert.ok(retry.messages[0].content.includes('"verdict"'));
});

test("OpenRouter: erro do modelo com HTTP 200 vira erro claro", async () => {
  const fetchImpl = mockFetch([
    [/openrouter\.ai/, () => jsonResponse({ choices: [{ error: { code: 502, message: "upstream down" }, finish_reason: "error" }] })],
  ]);
  await assert.rejects(callLLM({ ...base, provider: "openrouter", fetchImpl }), (err) => err instanceof LLMError && /HTTP 502/.test(err.message));
});

test("OpenRouter: 402 avisa que faltam créditos", async () => {
  const fetchImpl = mockFetch([[/openrouter\.ai/, () => jsonResponse({ error: { code: 402, message: "Insufficient credits" } }, 402)]]);
  await assert.rejects(
    callLLM({ ...base, provider: "openrouter", fetchImpl }),
    (err) => err instanceof LLMError && err.code === "NO_CREDITS" && /créditos/.test(err.message)
  );
});

test("testConnection faz uma chamada real mínima com schema", async () => {
  const fetchImpl = mockFetch([[/openrouter\.ai/, () => chatCompletion('{"ok": true}')]]);
  const out = await testConnection({ provider: "openrouter", apiKey: "k", model: "m" }, { fetchImpl, sleep: noSleep });
  assert.equal(out.ok, true);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].body.response_format.json_schema.name, "ping");
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
  const fetchImpl = mockFetch([[/openrouter\.ai/, () => chatCompletion(loose)]]);
  const out = await completeJSON({ ...base, provider: "openrouter", fetchImpl, normalize: normalizeVerdictPayload });
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
    [401, /recusou a chave/],
    [404, /não encontrou esse modelo/],
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

test("Gemini: chave inválida (HTTP 400) vira erro de chave, não de schema", async () => {
  const body = { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } };
  const fetchImpl = mockFetch([[/generativelanguage/, () => jsonResponse(body, 400)]]);
  await assert.rejects(
    callLLM({ ...base, provider: "gemini", fetchImpl }),
    (err) => err instanceof LLMError && err.code === "BAD_KEY"
  );
  assert.equal(fetchImpl.calls.length, 1, "não repete sem schema");
});
