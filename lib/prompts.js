// Todos os prompts do ClaimCheck ficam aqui. Os builders recebem dados já
// normalizados e devolvem strings; nenhuma chamada de rede acontece neste arquivo.

export const PROMPT_VERSION = "2";

const MAX_PAGE_CHARS = 9000;

export const EXTRACT_SYSTEM_PROMPT = `You are the claim extraction step of ClaimCheck, a fact-checking tool.
Read the page text and return the checkable factual claims it makes.

Rules:
- Keep only claims that could be confirmed or refuted with public sources: numbers, dates, events, people, places, products, scientific facts.
- Skip opinions, predictions about the future, jokes, rhetorical questions and value judgements.
- Each claim must be a short standalone sentence in the SAME language as the page. Resolve pronouns ("he", "the company") into full names.
- Prefer the most important and specific claims. Do not repeat the same fact twice.
- "context": one sentence saying who or what the claim is about, using names from the page.
- "search_query": a short English web search query (3 to 10 words) with the full names needed to avoid homonyms.
- "page_summary": 1 or 2 sentences describing what the page is about.
- "language": ISO 639-1 code of the page text.
- If there are no checkable claims, return an empty "claims" array.
Answer with JSON only.`;

export function buildExtractPrompt({ text, url, title, maxClaims }) {
  return `Page URL: ${url || "(unknown)"}
Page title: ${title || "(unknown)"}
Return at most ${maxClaims} claims.

Page text:
"""
${truncate(text, MAX_PAGE_CHARS)}
"""`;
}

export const VERIFY_SYSTEM_PROMPT = `You are the verification step of ClaimCheck, a fact-checking tool.
You receive one claim and a numbered list of evidence excerpts (E1, E2, ...) collected by a search agent.
Decide the verdict using the evidence.

Verdicts:
- "supported": the evidence explicitly confirms the claim about the same subject.
- "refuted": the evidence explicitly contradicts the claim about the same subject (for example a different date, number, place or person).
- "not_enough_evidence": the evidence is missing, off-topic, about a homonym, ambiguous, or the claim is about something that public sources cannot settle (private details, future events, untestable statements).

Rules:
- Base the verdict on the evidence. You may use general knowledge to read the evidence, but a "supported" or "refuted" verdict must cite at least one evidence id that backs it.
- "citations": ids of the excerpts you actually relied on, for example ["E2"]. Never invent ids. Use [] when nothing is relevant.
- "confidence": number from 0 to 1. Above 0.8 only when the cited evidence is direct and unambiguous.
- "explanation": 1 to 3 short sentences in the SAME language as the claim, mentioning what the evidence says.
Answer with JSON only.`;

export function buildVerifyPrompt({ claim, context, pageSummary, evidence }) {
  const evidenceBlock = evidence.length
    ? evidence
        .map(
          (e) => `[${e.id}] ${e.title}
Source: ${e.domain || e.url} (${e.provider})
Excerpt: ${e.text}`
        )
        .join("\n\n")
    : "(no evidence found)";

  const lines = [`Claim: ${claim}`];
  if (context) lines.push(`Claim context: ${context}`);
  if (pageSummary) lines.push(`Page summary: ${pageSummary}`);
  lines.push("", "Evidence:", evidenceBlock);
  return lines.join("\n");
}

/** Para provedores sem structured output nativo: descreve o schema no prompt. */
export function schemaInstruction(schema) {
  return `\n\nThe JSON must follow this JSON Schema exactly:\n${JSON.stringify(schema)}`;
}

export function retryInstruction(problem) {
  return `\n\nYour previous answer was rejected: ${problem}. Answer again with JSON only, following the schema.`;
}

function truncate(text, max) {
  const value = String(text || "");
  return value.length <= max ? value : `${value.slice(0, max)}\n[...truncated...]`;
}
