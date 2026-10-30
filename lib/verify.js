// Veredito por claim: chama o LLM com as evidências e pós-processa a resposta
// para que as citações apontem só para fontes que realmente foram mostradas.

import { completeJSON } from "./llm.js";
import { VERIFY_SYSTEM_PROMPT, buildVerifyPrompt } from "./prompts.js";
import { VERDICT_SCHEMA, VERDICTS } from "./schemas.js";

const VERDICT_SYNONYMS = {
  supported: "supported",
  support: "supported",
  supports: "supported",
  true: "supported",
  correct: "supported",
  confirmed: "supported",
  verdadeiro: "supported",
  refuted: "refuted",
  refute: "refuted",
  false: "refuted",
  incorrect: "refuted",
  falso: "refuted",
  not_enough_evidence: "not_enough_evidence",
  "not enough evidence": "not_enough_evidence",
  "not-enough-evidence": "not_enough_evidence",
  nei: "not_enough_evidence",
  unverifiable: "not_enough_evidence",
  unknown: "not_enough_evidence",
  insufficient_evidence: "not_enough_evidence",
};

export const NO_CITATION_CONFIDENCE_CAP = 0.3;

/**
 * Corrige variações comuns antes da validação do schema:
 * rótulos sinônimos, confiança em 0 a 100, citações como string ou número.
 */
export function normalizeVerdictPayload(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const out = { ...raw };

  if (typeof out.verdict === "string" || typeof out.verdict === "boolean") {
    const key = String(out.verdict).trim().toLowerCase();
    out.verdict = VERDICT_SYNONYMS[key] || VERDICT_SYNONYMS[key.replace(/\s+/g, "_")] || key;
  }

  let confidence = typeof out.confidence === "string" ? parseFloat(out.confidence) : out.confidence;
  if (typeof confidence === "number" && Number.isFinite(confidence)) {
    if (confidence > 1 && confidence <= 100) confidence /= 100;
    out.confidence = Math.max(0, Math.min(1, confidence));
  }

  if (typeof out.citations === "string") out.citations = out.citations.split(/[,\s]+/).filter(Boolean);
  if (Array.isArray(out.citations)) out.citations = out.citations.map((c) => String(c));
  if (out.explanation == null) out.explanation = "";
  return out;
}

/**
 * Transforma a resposta validada no resultado final:
 * - ids de citação inexistentes são descartados ("E9" quando só há E1..E4);
 * - "supported"/"refuted" sem nenhuma citação válida vira "not_enough_evidence",
 *   porque o ClaimCheck não mostra veredito que não aponte para uma fonte.
 */
export function finalizeVerdict(raw, evidence) {
  const payload = normalizeVerdictPayload(raw) || {};
  let verdict = VERDICTS.includes(payload.verdict) ? payload.verdict : "not_enough_evidence";
  let confidence = Number.isFinite(payload.confidence) ? payload.confidence : 0.5;
  const notes = [];

  const byId = new Map(evidence.map((e) => [e.id.toUpperCase(), e]));
  const seen = new Set();
  const citations = [];
  for (const rawId of payload.citations || []) {
    const id = String(rawId).trim().replace(/^\[|\]$/g, "").toUpperCase();
    const normalized = /^\d+$/.test(id) ? `E${id}` : id;
    const item = byId.get(normalized);
    if (!item || seen.has(normalized)) continue;
    seen.add(normalized);
    citations.push({ id: item.id, title: item.title, url: item.url, domain: item.domain, provider: item.provider });
  }

  if (verdict !== "not_enough_evidence" && citations.length === 0) {
    notes.push(`modelo respondeu "${verdict}" sem citar evidência válida`);
    verdict = "not_enough_evidence";
    confidence = Math.min(confidence, NO_CITATION_CONFIDENCE_CAP);
  }

  return {
    verdict,
    confidence: Math.round(confidence * 100) / 100,
    explanation: String(payload.explanation || "").trim(),
    citations,
    notes,
  };
}

/**
 * Verifica um claim já com evidências.
 * @returns {Promise<{verdict, confidence, explanation, citations, notes}>}
 */
export async function verifyClaim({ claim, context = "", pageSummary = "", evidence, llm, deps = {} }) {
  const raw = await completeJSON({
    ...llm,
    ...deps,
    system: VERIFY_SYSTEM_PROMPT,
    user: buildVerifyPrompt({ claim, context, pageSummary, evidence }),
    schema: VERDICT_SCHEMA,
    schemaName: "verdict",
    normalize: normalizeVerdictPayload,
  });
  return finalizeVerdict(raw, evidence);
}
