// Fetch com timeout e retry para 429/5xx/erros de rede.
// Funciona igual no service worker da extensão e no Node (eval e testes).

export class HttpError extends Error {
  constructor(message, { status = 0, body = "", url = "" } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);
const MAX_RETRY_AFTER_MS = 10_000;

export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

/**
 * Faz a requisição e devolve o Response quando ok.
 * Lança HttpError (com status) quando esgota as tentativas ou recebe erro não recuperável.
 */
export async function fetchWithRetry(url, init = {}, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    timeoutMs = 15_000,
    retries = 2,
    baseDelayMs = 800,
    sleep = defaultSleep,
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
      lastError = new HttpError(isTimeout ? `Tempo esgotado (${timeoutMs} ms)` : `Falha de rede: ${err?.message || err}`, {
        status: 0,
        url,
      });
      if (attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
      throw lastError;
    }

    if (response.ok) return response;

    const body = await safeText(response);
    lastError = new HttpError(`HTTP ${response.status}`, { status: response.status, body, url });

    if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
      const retryAfter = parseRetryAfter(response.headers?.get?.("retry-after"));
      const delay = retryAfter != null ? Math.min(retryAfter, MAX_RETRY_AFTER_MS) : baseDelayMs * 2 ** attempt;
      await sleep(delay);
      continue;
    }
    throw lastError;
  }
  throw lastError;
}

async function safeText(response) {
  try {
    return await response.text();
  } catch (_) {
    return "";
  }
}

/** Extrai a mensagem de erro do corpo JSON típico das APIs ({ error: { message } }). */
export function errorDetail(body) {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return String(first?.error?.message || first?.message || first?.detail || "").slice(0, 300);
  } catch (_) {
    return String(body).slice(0, 300);
  }
}
