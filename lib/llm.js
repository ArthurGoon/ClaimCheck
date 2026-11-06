// Camada de LLM: um adaptador por provedor, todos devolvendo texto.
// completeJSON() junta structured output, parsing, validação e retry.

import { fetchWithRetry, HttpError, AbortedError, errorDetail } from "./http.js";
import { parseJsonLoose, validateSchema, JsonOutputError } from "./json.js";
import { schemaInstruction, retryInstruction } from "./prompts.js";
import { providerName } from "./providers.js";
import { callMock } from "./mock-llm.js";

const LLM_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 8000;

export const APP_URL = "https://github.com/ArthurGoon/ClaimCheck";
export const APP_TITLE = "ClaimCheck";

export class LLMError extends Error {
  constructor(message, { status = 0, provider = "", code = "" } = {}) {
    super(message);
    this.name = "LLMError";
    this.status = status;
    this.provider = provider;
    // code ajuda o painel a decidir a ação sugerida (ex.: abrir configurações).
    this.code = code;
  }
}

const ADAPTERS = {
  openrouter: callOpenAICompatible,
  openai: callOpenAICompatible,
  anthropic: callAnthropic,
  gemini: callGemini,
  // Só para testes automatizados e screenshots. Não aparece na interface.
  mock: callMock,
};

const ENDPOINTS = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
};

/**
 * Chama o provedor e devolve o texto da resposta.
 * Se o provedor recusar o structured output (schema não suportado pelo modelo),
 * repete uma vez pedindo JSON só pelo prompt.
 */
export async function callLLM(opts) {
  const { provider, apiKey } = opts;
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new LLMError(`Provedor desconhecido: ${provider}`);
  if (!apiKey && provider !== "mock") throw new LLMError("Falta a chave de API.", { provider, code: "NO_KEY" });

  const native = Boolean(opts.schema);
  try {
    return await adapter({ ...opts, native });
  } catch (err) {
    if (native && rejectedStructuredOutput(err)) {
      try {
        return await adapter({ ...opts, native: false });
      } catch (inner) {
        throw toLLMError(inner, provider);
      }
    }
    throw toLLMError(err, provider);
  }
}

/** 400 citando schema/format, ou a OpenRouter dizendo que nenhum endpoint aceita os parâmetros. */
function rejectedStructuredOutput(err) {
  if (!(err instanceof HttpError)) return false;
  if (err.status === 400 && /schema|response_format|output_config|format/i.test(err.body)) return true;
  return (err.status === 404 || err.status === 503) && /parameter|structured|response_format/i.test(err.body);
}

/**
 * Pede JSON ao modelo, valida contra o schema e tenta de novo (uma vez, por padrão)
 * quando a resposta vem malformada. normalize() roda antes da validação para
 * corrigir variações inofensivas (ex.: "true" em vez de "supported").
 */
export async function completeJSON(opts) {
  const { schema, normalize = (x) => x, maxAttempts = 2 } = opts;
  let user = opts.user;
  let lastProblem = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const text = await callLLM({ ...opts, user });
      const value = normalize(parseJsonLoose(text));
      const errors = schema ? validateSchema(value, schema) : [];
      if (errors.length === 0) return value;
      lastProblem = errors.slice(0, 3).join("; ");
    } catch (err) {
      if (!(err instanceof JsonOutputError)) throw err;
      lastProblem = err.message;
    }
    user = opts.user + retryInstruction(lastProblem);
  }
  throw new LLMError(`O modelo respondeu fora do formato esperado (${lastProblem}). Tente outro modelo.`, {
    provider: opts.provider,
    code: "BAD_OUTPUT",
  });
}

const PING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

/**
 * Chamada mínima e real ao provedor, com o mesmo caminho de structured output
 * usado na verificação. Serve para o botão "Testar conexão".
 */
export async function testConnection(llm, deps = {}) {
  const started = Date.now();
  await completeJSON({
    ...llm,
    ...deps,
    system: "You are a health check. Answer with JSON only.",
    user: 'Reply with {"ok": true}.',
    schema: PING_SCHEMA,
    schemaName: "ping",
    maxAttempts: 1,
  });
  return { ok: true, elapsedMs: Date.now() - started };
}

function toLLMError(err, provider) {
  if (err instanceof LLMError || err instanceof JsonOutputError || err instanceof AbortedError) return err;
  const name = (prep) => providerName(provider, prep);
  const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  if (err instanceof HttpError) {
    const detail = errorDetail(err.body);
    const status = err.status;
    // O Gemini responde chave inválida com 400 em vez de 401.
    const invalidKey = status === 400 && /API[_ ]KEY[_ ]INVALID|API key not valid/i.test(err.body);
    if (status === 401 || invalidKey || (status === 403 && provider !== "openrouter")) {
      return new LLMError(`${cap(name(""))} recusou a chave. Confira se ela foi colada inteira.`, { status, provider, code: "BAD_KEY" });
    }
    if (status === 402) {
      return new LLMError(`Sem créditos ${name("em")}. Adicione créditos na sua conta e tente de novo.`, {
        status,
        provider,
        code: "NO_CREDITS",
      });
    }
    if (status === 404) {
      return new LLMError(`${cap(name(""))} não encontrou esse modelo. Confira o nome nas configurações.${detail ? ` (${detail})` : ""}`, {
        status,
        provider,
        code: "BAD_MODEL",
      });
    }
    if (status === 429) {
      return new LLMError(`Limite de uso ${name("de")} atingido. Espere um pouco e tente de novo.`, { status, provider, code: "RATE_LIMIT" });
    }
    if (status === 0) {
      return new LLMError(`Sem resposta ${name("de")} (${err.message}). Confira sua conexão.`, { provider, code: "NETWORK" });
    }
    return new LLMError(`Erro ${name("de")} (HTTP ${status})${detail ? `: ${detail.replace(/[.\s]+$/, "")}` : ""}.`, { status, provider });
  }
  return new LLMError(err?.message || String(err), { provider });
}

function httpOptions(opts) {
  return { fetchImpl: opts.fetchImpl, sleep: opts.sleep, signal: opts.signal, timeoutMs: opts.timeoutMs || LLM_TIMEOUT_MS, retries: 2 };
}

async function callOpenAICompatible(opts) {
  const { provider, apiKey, model, system, user, schema, schemaName = "result", native } = opts;
  const body = {
    model,
    messages: [
      { role: "system", content: native || !schema ? system : system + schemaInstruction(schema) },
      { role: "user", content: user },
    ],
    response_format: native
      ? { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } }
      : { type: "json_object" },
  };
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };

  if (provider === "openrouter") {
    // Com structured output, só roteia para endpoints que aceitam o parâmetro.
    if (native) body.provider = { require_parameters: true };
    headers["HTTP-Referer"] = APP_URL;
    headers["X-Title"] = APP_TITLE;
  }

  const response = await fetchWithRetry(
    ENDPOINTS[provider],
    { method: "POST", headers, body: JSON.stringify(body) },
    httpOptions(opts)
  );
  const data = await response.json();
  const choice = data?.choices?.[0];
  // A OpenRouter pode devolver erro do modelo com HTTP 200.
  const inlineError = data?.error || choice?.error;
  if (inlineError) {
    throw new HttpError(`HTTP ${inlineError.code || 502}`, {
      status: Number(inlineError.code) || 502,
      body: JSON.stringify({ error: inlineError }),
    });
  }
  if (choice?.message?.refusal) throw new LLMError(`O modelo recusou a tarefa: ${choice.message.refusal}`, { provider });
  if (choice?.finish_reason === "length") throw new JsonOutputError("Resposta cortada por limite de tokens.");
  return choice?.message?.content || "";
}

async function callAnthropic(opts) {
  const { apiKey, model, system, user, schema, native } = opts;
  const body = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: native || !schema ? system : system + schemaInstruction(schema),
    messages: [{ role: "user", content: user }],
  };
  if (native) body.output_config = { format: { type: "json_schema", schema } };

  const response = await fetchWithRetry(
    ENDPOINTS.anthropic,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // Necessário para chamar a API direto do navegador (a chave é do próprio usuário).
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    },
    httpOptions(opts)
  );
  const data = await response.json();
  if (data?.stop_reason === "refusal") throw new LLMError("O modelo recusou a tarefa.", { provider: "anthropic" });
  if (data?.stop_reason === "max_tokens") throw new JsonOutputError("Resposta cortada por limite de tokens.");
  return (data?.content || [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("");
}

async function callGemini(opts) {
  const { apiKey, model, system, user, schema, native } = opts;
  const generationConfig = { responseMimeType: "application/json" };
  if (native) generationConfig.responseSchema = toGeminiSchema(schema);

  const response = await fetchWithRetry(
    `${ENDPOINTS.gemini}/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: native || !schema ? system : system + schemaInstruction(schema) }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig,
      }),
    },
    httpOptions(opts)
  );
  const data = await response.json();
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    const reason = data?.promptFeedback?.blockReason;
    throw new LLMError(reason ? `O Gemini bloqueou o pedido (${reason}).` : "Resposta vazia do Gemini.", { provider: "gemini" });
  }
  if (candidate.finishReason === "MAX_TOKENS") throw new JsonOutputError("Resposta cortada por limite de tokens.");
  return (candidate.content?.parts || [])
    .filter((part) => typeof part?.text === "string" && !part.thought)
    .map((part) => part.text)
    .join("");
}

/** responseSchema do Gemini usa um subconjunto de OpenAPI: sem additionalProperties. */
export function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties") continue;
    out[key] = typeof value === "object" ? toGeminiSchema(value) : value;
  }
  return out;
}
