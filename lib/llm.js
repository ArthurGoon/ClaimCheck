// Camada de LLM: um adaptador por provedor, todos devolvendo texto.
// completeJSON() junta structured output, parsing, validação e retry.

import { fetchWithRetry, HttpError, errorDetail } from "./http.js";
import { parseJsonLoose, validateSchema, JsonOutputError } from "./json.js";
import { schemaInstruction, retryInstruction } from "./prompts.js";
import { getLlmProvider } from "./providers.js";

const LLM_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 8000;

export class LLMError extends Error {
  constructor(message, { status = 0, provider = "" } = {}) {
    super(message);
    this.name = "LLMError";
    this.status = status;
    this.provider = provider;
  }
}

const ADAPTERS = {
  openai: callOpenAICompatible,
  deepseek: callOpenAICompatible,
  anthropic: callAnthropic,
  gemini: callGemini,
};

const ENDPOINTS = {
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
};

// DeepSeek só oferece JSON mode ({type: "json_object"}), sem schema.
const NATIVE_SCHEMA = new Set(["openai", "anthropic", "gemini"]);

/**
 * Chama o provedor e devolve o texto da resposta.
 * Se o provedor recusar o structured output (HTTP 400 citando schema/format),
 * repete uma vez pedindo JSON só pelo prompt.
 */
export async function callLLM(opts) {
  const { provider, apiKey } = opts;
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new LLMError(`Provedor desconhecido: ${provider}`);
  if (!apiKey) throw new LLMError("API key não configurada.", { provider });

  const native = NATIVE_SCHEMA.has(provider) && Boolean(opts.schema);
  try {
    return await adapter({ ...opts, native });
  } catch (err) {
    if (native && err instanceof HttpError && err.status === 400 && /schema|response_format|output_config|format/i.test(err.body)) {
      try {
        return await adapter({ ...opts, native: false });
      } catch (inner) {
        throw toLLMError(inner, provider);
      }
    }
    throw toLLMError(err, provider);
  }
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
  throw new LLMError(`Resposta do modelo fora do formato esperado (${lastProblem}).`, { provider: opts.provider });
}

function toLLMError(err, provider) {
  if (err instanceof LLMError || err instanceof JsonOutputError) return err;
  const label = getLlmProvider(provider).label;
  if (err instanceof HttpError) {
    const detail = errorDetail(err.body);
    if (err.status === 401 || err.status === 403) {
      return new LLMError(`API key recusada pela ${label}.`, { status: err.status, provider });
    }
    if (err.status === 404) {
      return new LLMError(`Modelo não encontrado na ${label}. Confira o nome do modelo nas opções.${detail ? ` (${detail})` : ""}`, {
        status: 404,
        provider,
      });
    }
    if (err.status === 429) {
      return new LLMError(`Limite de uso da ${label} atingido. Tente de novo em instantes.`, { status: 429, provider });
    }
    if (err.status === 0) {
      return new LLMError(`Sem resposta da ${label}: ${err.message}.`, { provider });
    }
    return new LLMError(`Erro da ${label} (HTTP ${err.status})${detail ? `: ${detail}` : ""}.`, { status: err.status, provider });
  }
  return new LLMError(err?.message || String(err), { provider });
}

function httpOptions(opts) {
  return { fetchImpl: opts.fetchImpl, sleep: opts.sleep, timeoutMs: opts.timeoutMs || LLM_TIMEOUT_MS, retries: 2 };
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

  const response = await fetchWithRetry(
    ENDPOINTS[provider],
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    },
    httpOptions(opts)
  );
  const data = await response.json();
  const choice = data?.choices?.[0];
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
    throw new LLMError(reason ? `Gemini bloqueou o pedido (${reason}).` : "Resposta vazia do Gemini.", { provider: "gemini" });
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
