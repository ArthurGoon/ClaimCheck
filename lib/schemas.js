// JSON Schemas das saídas do LLM. Usados de três formas:
// 1) structured output nativo do provedor (OpenAI, Anthropic, Gemini);
// 2) descrição no prompt para quem só tem "JSON mode" (DeepSeek);
// 3) validação local de toda resposta (lib/json.js), com retry quando falha.
// Todos os campos são obrigatórios e sem propriedades extras, o que o modo strict exige.

export const VERDICTS = ["supported", "refuted", "not_enough_evidence"];

export const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["page_summary", "language", "claims"],
  properties: {
    page_summary: { type: "string", description: "1-2 frases sobre o assunto da página" },
    language: { type: "string", description: "código ISO 639-1 do texto, ex.: pt, en" },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "context", "search_query"],
        properties: {
          text: { type: "string", description: "a afirmação, autocontida, no idioma original" },
          context: { type: "string", description: "a quem ou a que a afirmação se refere" },
          search_query: { type: "string", description: "consulta curta em inglês com os nomes completos" },
        },
      },
    },
  },
};

export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "confidence", "explanation", "citations"],
  properties: {
    verdict: { type: "string", enum: VERDICTS },
    confidence: { type: "number", description: "0 a 1" },
    explanation: { type: "string" },
    citations: {
      type: "array",
      description: "ids das evidências usadas, ex.: [\"E1\", \"E3\"]",
      items: { type: "string" },
    },
  },
};
