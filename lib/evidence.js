// Funções puras de texto e ranqueamento de evidências (sem rede).

const STOPWORDS = new Set(
  (
    // português
    "a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para pra com sem sob " +
    "e ou mas que se é foi são era eram ser sido está estão esta este isso isto essa esse ao aos à às como mais " +
    "menos muito muita seu sua seus suas ele ela eles elas já também quando onde qual quais quem entre sobre até " +
    "após ter tem têm tinha há nao não sim lhe lhes meu minha nosso nossa " +
    // inglês
    "the a an of in on at to for from by with without and or but is are was were be been being has have had " +
    "it its this that these those as than then there their they he she his her them which who whom what when " +
    "where how not no yes do does did into over under about after before also more most such only very can will"
  )
    .split(/\s+/)
    .flatMap((w) => [w, stripAccents(w)])
);

function stripAccents(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Consulta curta de palavras-chave a partir da frase do claim (bom para a Wikipedia). */
export function keywordQuery(text, maxTerms = 8) {
  const words = String(text || "")
    .split(/[^\p{L}\p{N}-]+/u)
    .filter(Boolean)
    .filter((w) => !STOPWORDS.has(w.toLowerCase()) && (w.length > 1 || /\d/.test(w)));
  return [...new Set(words)].slice(0, maxTerms).join(" ");
}

export function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

const INLINE_TAGS = /<\/?(?:a|abbr|b|cite|code|em|i|mark|small|span|strong|sub|sup|u)\b[^>]*>/gi;

export function stripTags(value) {
  return decodeEntities(String(value || "").replace(INLINE_TAGS, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

/** Converte HTML de uma página em texto corrido, descartando script, estilo e navegação. */
export function htmlToText(html) {
  const body = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, ". ")
    .replace(/<br\s*\/?>/gi, ". ");
  return stripTags(body).replace(/(\.\s*){2,}/g, ". ");
}

export function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\d"“(])/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 600);
}

/**
 * Escolhe os trechos da página mais ligados ao claim (sobreposição de termos),
 * mantendo a ordem original. Evita mandar ao LLM o começo da página, que costuma ser menu.
 */
export function selectPassages(text, claim, maxChars = 1200) {
  const terms = new Set(tokenize(claim));
  if (!terms.size) return String(text || "").slice(0, maxChars);

  const scored = splitSentences(text).map((sentence, index) => {
    const tokens = new Set(tokenize(sentence));
    let hits = 0;
    for (const term of terms) if (tokens.has(term)) hits += 1;
    const hasNumber = /\d/.test(sentence) && [...terms].some((t) => /\d/.test(t)) ? 0.5 : 0;
    return { sentence, index, score: hits + hasNumber };
  });

  const picked = [];
  let used = 0;
  for (const item of scored.filter((s) => s.score >= 1).sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (used + item.sentence.length > maxChars) continue;
    picked.push(item);
    used += item.sentence.length + 3;
  }
  return picked
    .sort((a, b) => a.index - b.index)
    .map((p) => p.sentence)
    .join(" … ");
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$)/i.test(key)) u.searchParams.delete(key);
    }
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${path}${u.search}`;
  } catch (_) {
    return String(url || "");
  }
}

// Bônus pequeno para fontes de referência. Não decide sozinho: a relevância pesa mais.
const REFERENCE_DOMAINS = /(^|\.)(wikipedia\.org|britannica\.com|gov\.br|gov|edu|who\.int|un\.org|reuters\.com|apnews\.com|bbc\.co\.uk|bbc\.com|g1\.globo\.com|ibge\.gov\.br|nature\.com|nih\.gov)$/i;

/** Relevância léxica entre o claim e o resultado, em [0, 1], mais um bônus de fonte. */
export function scoreResult(result, claimTerms) {
  const terms = claimTerms instanceof Set ? claimTerms : new Set(claimTerms);
  if (!terms.size) return 0;
  const titleTokens = new Set(tokenize(result.title));
  const textTokens = new Set(tokenize(result.text));
  let score = 0;
  for (const term of terms) {
    if (titleTokens.has(term)) score += 1;
    else if (textTokens.has(term)) score += 0.7;
  }
  score /= terms.size;
  if (REFERENCE_DOMAINS.test(domainOf(result.url))) score += 0.1;
  if (!result.text || result.text.length < 40) score -= 0.15;
  return Math.round(score * 1000) / 1000;
}

/**
 * Remove duplicatas (mesma URL normalizada), limita resultados por domínio,
 * descarta os irrelevantes e ordena por relevância.
 */
export function rankEvidence(results, claim, { limit = 6, perDomain = 2, minScore = 0.2 } = {}) {
  const terms = new Set(tokenize(claim));
  const byUrl = new Map();

  for (const result of results) {
    if (!result?.url || !/^https?:\/\//.test(result.url)) continue;
    const key = normalizeUrl(result.url);
    const scored = { ...result, domain: domainOf(result.url), score: scoreResult(result, terms) };
    const existing = byUrl.get(key);
    if (!existing || scored.score > existing.score) byUrl.set(key, scored);
  }

  const perDomainCount = new Map();
  const ranked = [];
  for (const item of [...byUrl.values()].sort((a, b) => b.score - a.score)) {
    if (item.score < minScore) continue;
    const count = perDomainCount.get(item.domain) || 0;
    if (count >= perDomain) continue;
    perDomainCount.set(item.domain, count + 1);
    ranked.push(item);
    if (ranked.length >= limit) break;
  }
  return ranked;
}
