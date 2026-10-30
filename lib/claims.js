// Pós-processamento da extração de claims feita pelo LLM.

const MIN_CLAIM_CHARS = 12;
const MAX_CLAIM_CHARS = 400;

function clean(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeKey(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Normaliza a saída da extração. Aceita tanto o formato do schema
 * ({ text, context, search_query }) quanto variações (string solta, "claim", "searchQuery").
 * Remove vazios, curtos demais, longos demais e duplicados; corta em maxClaims.
 */
export function normalizeExtractedClaims(payload, maxClaims = 5) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.claims) ? payload.claims : [];
  const seen = new Set();
  const claims = [];

  for (const item of list) {
    const obj = typeof item === "string" ? { text: item } : item && typeof item === "object" ? item : null;
    if (!obj) continue;

    const text = clean(obj.text ?? obj.claim).replace(/^["“']|["”']$/g, "");
    if (text.length < MIN_CLAIM_CHARS || text.length > MAX_CLAIM_CHARS) continue;

    const key = dedupeKey(text);
    if (seen.has(key)) continue;
    seen.add(key);

    claims.push({
      text,
      context: clean(obj.context),
      searchQuery: clean(obj.search_query ?? obj.searchQuery).slice(0, 200),
    });
    if (claims.length >= maxClaims) break;
  }
  return claims;
}
