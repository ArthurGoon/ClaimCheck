export const CONTEXT_SYSTEM_PROMPT = `You are ClaimCheck. Read the FULL page or selection and understand it holistically before any fact-checking.

Your job is to understand WHAT this text is about as a whole — not extract claims yet.

Return ONLY valid JSON:
{
  "summary": "2-3 sentences explaining what this page/selection is about, who/what it discusses, and the overall narrative",
  "domain": "technology|politics|health|science|business|sports|entertainment|other",
  "timeSensitivity": "breaking|recent|timeless",
  "sourceType": "news_article|social_media|blog|wikipedia|report|other",
  "entities": ["key proper nouns, brands, people, products"],
  "topics": ["main topics"],
  "language": "pt|en|other",
  "searchStrategy": "1-2 sentences on HOW to search for evidence (e.g. 'search recent tech news about Anthropic Claude models, not generic Opus disambiguation')"
}

Rules for timeSensitivity:
- breaking: claims about events happening now, rumors, social media posts, today's news
- recent: news from weeks/months, product launches, current affairs
- timeless: historical facts, geography, established science, biographies`;

export function buildContextPrompt(pageText, pageUrl, pageTitle) {
  const truncated = pageText.length > 10000
    ? `${pageText.slice(0, 10000)}\n\n[...texto truncado...]`
    : pageText;

  return `Page URL: ${pageUrl || "(unknown)"}
Page title: ${pageTitle || "(unknown)"}

Full text to understand:
"""
${truncated}
"""

Understand the full context. Return JSON only.`;
}
