// Utilitários de teste: fetch falso roteado por URL, sem rede.

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function textResponse(body, status = 200, contentType = "text/html") {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

/**
 * routes: lista de [teste, handler]. teste é RegExp (na URL) ou função (url, init).
 * handler recebe (url, init, callIndex) e devolve Response (ou lança).
 * Requisições sem rota falham com 599 para o teste perceber.
 */
export function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, init, body: init.body ? safeJson(init.body) : undefined });
    for (const [test, handler] of routes) {
      const match = test instanceof RegExp ? test.test(href) : test(href, init);
      if (match) {
        const index = calls.filter((c) => c.url === href).length - 1;
        return handler(href, init, index);
      }
    }
    return new Response("no route", { status: 599 });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

export const noSleep = async () => {};

function safeJson(body) {
  try {
    return JSON.parse(body);
  } catch (_) {
    return body;
  }
}

/** Resposta no formato Chat Completions (OpenAI / DeepSeek). */
export function chatCompletion(content) {
  return jsonResponse({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] });
}

/** Resposta no formato Messages API (Anthropic). */
export function anthropicMessage(text, stopReason = "end_turn") {
  return jsonResponse({
    content: [
      { type: "thinking", thinking: "" },
      { type: "text", text },
    ],
    stop_reason: stopReason,
  });
}

/** Resposta no formato generateContent (Gemini). */
export function geminiResponse(text) {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text: "pensando", thought: true }, { text }] }, finishReason: "STOP" }],
  });
}
