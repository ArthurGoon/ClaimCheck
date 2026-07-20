import { VERIFY_SYSTEM_PROMPT, buildVerifyPrompt } from "./prompts.js";
import { parseJsonContent, normalizeClaims } from "./utils.js";

export async function verifyClaimsWithEvidence(provider, apiKey, claimsWithSearch, callLLM) {
  const parsed = await callLLM(provider, apiKey, {
    system: VERIFY_SYSTEM_PROMPT,
    user: buildVerifyPrompt(claimsWithSearch),
  });

  const verified = normalizeClaims(parsed?.claims);
  if (verified.length > 0) {
    return verified.map((claim, index) => ({
      ...claim,
      searchCount: claimsWithSearch[index]?.searchResults?.length || 0,
      sources: claim.sources?.length
        ? claim.sources
        : (claimsWithSearch[index]?.searchResults || []).slice(0, 3).map((r) => ({
            title: r.title,
            url: r.url,
          })),
    }));
  }

  return claimsWithSearch.map((item) => ({
    claim: item.claim,
    verdict: item.searchResults.length ? "misleading" : "unverifiable",
    confidence: item.searchResults.length ? 0.45 : 0.15,
    explanation: item.searchResults.length
      ? "Encontramos fontes na web, mas a IA não conseguiu classificar com confiança. Veja os links."
      : "Não encontramos fontes suficientes na web para este claim.",
    sources: item.searchResults.slice(0, 3).map((r) => ({ title: r.title, url: r.url })),
    searchCount: item.searchResults.length,
  }));
}

export { parseJsonContent };
