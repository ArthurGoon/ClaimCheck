// Pipeline completo: extrai claims -> busca evidências -> veredito.
// Não usa a API da extensão, então roda igual no service worker e no eval (Node).

import { completeJSON } from "./llm.js";
import { throwIfAborted, AbortedError } from "./http.js";
import { EXTRACT_SYSTEM_PROMPT, buildExtractPrompt } from "./prompts.js";
import { EXTRACT_SCHEMA } from "./schemas.js";
import { normalizeExtractedClaims } from "./claims.js";
import { gatherEvidence } from "./search/index.js";
import { verifyClaim } from "./verify.js";
import { resolveModel, DEFAULT_STORED } from "./providers.js";

const CLAIM_CONCURRENCY = 3;

export function llmOptions(settings) {
  return {
    provider: settings.llmProvider,
    apiKey: settings.llmApiKey,
    model: resolveModel(settings),
    mockScript: settings.mockScript,
  };
}

export async function extractClaims({ page, settings, deps = {} }) {
  const maxClaims = settings.maxClaims || DEFAULT_STORED.maxClaims;
  const parsed = await completeJSON({
    ...llmOptions(settings),
    ...deps,
    system: EXTRACT_SYSTEM_PROMPT,
    user: buildExtractPrompt({ text: page.text, url: page.url, title: page.title, maxClaims }),
    schema: EXTRACT_SCHEMA,
    schemaName: "claims",
    normalize: normalizeExtraction,
  });
  return {
    pageSummary: String(parsed.page_summary || "").trim(),
    language: String(parsed.language || "").trim().toLowerCase().slice(0, 2),
    claims: normalizeExtractedClaims(parsed, maxClaims),
  };
}

/** Campos secundários ausentes viram string vazia em vez de forçar um retry. */
function normalizeExtraction(value) {
  const claims = Array.isArray(value?.claims) ? value.claims : [];
  return {
    page_summary: "",
    language: "",
    ...value,
    claims: claims.map((c) =>
      c && typeof c === "object" ? { quote: "", context: "", search_query: "", ...c } : c
    ),
  };
}

/** Verifica um único claim. Também é a unidade usada pelo eval. */
export async function checkClaim({
  claim,
  context = "",
  searchQuery = "",
  lang,
  pageSummary = "",
  settings,
  deps = {},
  onStage = () => {},
}) {
  const started = Date.now();
  onStage("search");
  const search = await gatherEvidence({
    claim,
    searchQuery,
    lang,
    search: { provider: settings.searchProvider, apiKey: settings.searchApiKey },
    deps,
  });
  throwIfAborted(deps.signal);

  let verdict;
  if (search.evidence.length === 0) {
    // Sem nenhuma evidência não há o que perguntar ao modelo.
    verdict = {
      verdict: "not_enough_evidence",
      confidence: 0,
      explanation: "Nenhuma fonte relevante foi encontrada para esta afirmação.",
      citations: [],
      notes: ["sem evidências"],
    };
  } else {
    onStage("judge");
    verdict = await verifyClaim({ claim, context, pageSummary, evidence: search.evidence, llm: llmOptions(settings), deps });
  }

  return {
    claim,
    context,
    ...verdict,
    evidence: search.evidence,
    warnings: search.warnings,
    searchStats: search.stats,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Roda tudo e avisa o andamento por onProgress:
 *   { step: "extract" }
 *   { step: "claims", claims: [{ text, quote, context }] }
 *   { step: "claim", index, stage: "search" | "judge" }
 *   { step: "result", index, result }
 */
export async function checkPage({ page, settings, deps = {}, onProgress = () => {} }) {
  onProgress({ step: "extract" });
  const extracted = await extractClaims({ page, settings, deps });
  throwIfAborted(deps.signal);
  onProgress({
    step: "claims",
    claims: extracted.claims.map((c) => ({ text: c.text, quote: c.quote, context: c.context })),
  });
  if (!extracted.claims.length) {
    return { pageSummary: extracted.pageSummary, language: extracted.language, results: [], warnings: [] };
  }

  const results = await mapWithConcurrency(extracted.claims, CLAIM_CONCURRENCY, async (item, index) => {
    let result;
    try {
      result = await checkClaim({
        claim: item.text,
        context: item.context,
        searchQuery: item.searchQuery,
        lang: extracted.language,
        pageSummary: extracted.pageSummary,
        settings,
        deps,
        onStage: (stage) => onProgress({ step: "claim", index, stage }),
      });
    } catch (err) {
      if (err instanceof AbortedError) throw err;
      // Um claim com erro não derruba os outros.
      result = {
        claim: item.text,
        context: item.context,
        verdict: "error",
        confidence: 0,
        explanation: err?.message || "Falha ao verificar.",
        citations: [],
        evidence: [],
        warnings: [],
        notes: [],
      };
    }
    result.quote = item.quote;
    onProgress({ step: "result", index, result });
    return result;
  });

  const warnings = [...new Set(results.flatMap((r) => r.warnings || []))];
  return { pageSummary: extracted.pageSummary, language: extracted.language, results, warnings };
}

export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
