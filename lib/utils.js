export function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch (_) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Não foi possível interpretar a resposta da IA.");
    }
    return JSON.parse(jsonMatch[0]);
  }
}

export function normalizeClaims(raw) {
  if (!Array.isArray(raw)) return [];

  const allowed = new Set(["true", "false", "misleading", "unverifiable"]);

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const claim = String(item.claim || "").trim();
      if (!claim) return null;

      let verdict = String(item.verdict || "unverifiable").toLowerCase();
      if (!allowed.has(verdict)) verdict = "unverifiable";

      let confidence = Number(item.confidence);
      if (!Number.isFinite(confidence)) confidence = 0.5;
      confidence = Math.max(0, Math.min(1, confidence));

      const explanation = String(item.explanation || "").trim();

      const sources = Array.isArray(item.sources)
        ? item.sources
            .map((s) => ({
              title: String(s?.title || s?.url || "Fonte").trim(),
              url: String(s?.url || "").trim(),
            }))
            .filter((s) => s.url.startsWith("http"))
        : [];

      return { claim, verdict, confidence, explanation, sources };
    })
    .filter(Boolean)
    .slice(0, 8);
}
