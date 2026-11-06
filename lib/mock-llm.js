// SOMENTE PARA TESTES AUTOMATIZADOS E SCREENSHOTS.
//
// Modelo simulado que devolve respostas roteirizadas. Não aparece na interface:
// só é ativado quando o script de teste grava a chave "claimcheckDevMock" no
// storage local da extensão (ver background.js e scripts/screenshots.mjs).
// Serve para exercitar a interface e a busca real sem uma chave de LLM.
//
// Roteiro (opts.mockScript):
// {
//   delayMs: 500,                       // espera simulada por chamada
//   error: { status: 401, message },    // faz toda chamada falhar com esse HTTP
//   extract: { page_summary, language, claims: [{ text, context, search_query, quote }] },
//   verdicts: [{ match, verdict, confidence, explanation, citations, cite }]
//   (cite: trechos de títulos das evidências, para citar pela fonte e não pela posição)
// }

import { HttpError, AbortedError } from "./http.js";

export async function callMock(opts) {
  const script = opts.mockScript || {};
  await abortableDelay(script.delayMs ?? 400, opts.signal);

  if (script.error) {
    throw new HttpError(`HTTP ${script.error.status}`, {
      status: script.error.status,
      body: JSON.stringify({ error: { message: script.error.message || "erro simulado" } }),
    });
  }

  if (opts.schemaName === "ping") return JSON.stringify({ ok: true });
  if (opts.schemaName === "claims") {
    return JSON.stringify(script.extract || { page_summary: "", language: "en", claims: [] });
  }
  return JSON.stringify(mockVerdict(script, opts.user || ""));
}

export function mockVerdict(script, user) {
  const claim = (user.match(/^Claim: (.*)$/m) || [])[1] || "";
  const listed = [...user.matchAll(/^\[(E\d+)\] (.*)$/gm)].map((m) => ({ id: m[1], title: m[2] }));
  const available = listed.map((e) => e.id);
  const scripted =
    (script.verdicts || []).find((v) => v.match && claim.toLowerCase().includes(String(v.match).toLowerCase())) ||
    script.defaultVerdict || {
      verdict: "not_enough_evidence",
      confidence: 0.3,
      explanation: "As fontes encontradas não tratam diretamente desta afirmação.",
      citations: [],
    };

  const byTitle = listed.filter((e) => (scripted.cite || []).some((t) => e.title.includes(t))).map((e) => e.id);
  let citations = [...new Set([...byTitle, ...(scripted.citations || []).filter((id) => available.includes(id))])];
  if (!citations.length && scripted.verdict !== "not_enough_evidence" && available.length) citations = [available[0]];
  return { ...scripted, match: undefined, cite: undefined, citations };
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new AbortedError());
      },
      { once: true }
    );
  });
}
