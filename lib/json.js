// Parsing tolerante de JSON vindo de LLM e um validador mínimo de JSON Schema
// (só o subconjunto usado em lib/schemas.js: type, properties, required, items, enum).

export class JsonOutputError extends Error {
  constructor(message) {
    super(message);
    this.name = "JsonOutputError";
  }
}

/**
 * Aceita JSON puro, JSON dentro de bloco ```json``` ou JSON com texto antes/depois.
 */
export function parseJsonLoose(content) {
  if (content && typeof content === "object") return content;
  const text = String(content ?? "").trim();
  if (!text) throw new JsonOutputError("Resposta vazia do modelo.");

  try {
    return JSON.parse(text);
  } catch (_) {
    /* tenta as alternativas abaixo */
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {
      /* segue */
    }
  }

  const candidate = firstBalancedObject(text);
  if (candidate) {
    try {
      return JSON.parse(candidate);
    } catch (_) {
      /* segue */
    }
  }
  throw new JsonOutputError("O modelo não devolveu JSON válido.");
}

function firstBalancedObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}

/** Retorna lista de erros (vazia quando o valor é válido). */
export function validateSchema(value, schema, path = "$") {
  const errors = [];
  const type = schema.type;

  if (type && !matchesType(value, type)) {
    errors.push(`${path}: esperado ${type}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: valor fora de ${JSON.stringify(schema.enum)}`);
  }
  if (type === "object" && schema.properties) {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${path}.${key}: campo obrigatório ausente`);
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in value) errors.push(...validateSchema(value[key], sub, `${path}.${key}`));
    }
  }
  if (type === "array" && schema.items) {
    value.forEach((item, i) => errors.push(...validateSchema(item, schema.items, `${path}[${i}]`)));
  }
  return errors;
}

function matchesType(value, type) {
  switch (type) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return true;
  }
}
