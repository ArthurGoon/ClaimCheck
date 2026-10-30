import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonLoose, validateSchema, JsonOutputError } from "../lib/json.js";
import { VERDICT_SCHEMA, EXTRACT_SCHEMA } from "../lib/schemas.js";

test("parseJsonLoose aceita JSON puro", () => {
  assert.deepEqual(parseJsonLoose('{"a": 1}'), { a: 1 });
});

test("parseJsonLoose aceita bloco ```json```", () => {
  const text = 'Aqui está:\n```json\n{"verdict": "supported"}\n```\nfim';
  assert.deepEqual(parseJsonLoose(text), { verdict: "supported" });
});

test("parseJsonLoose extrai o primeiro objeto balanceado com texto em volta", () => {
  const text = 'Resposta: {"a": {"b": "chave } dentro de string"}, "c": [1, 2]} obrigado {"x": 1}';
  assert.deepEqual(parseJsonLoose(text), { a: { b: "chave } dentro de string" }, c: [1, 2] });
});

test("parseJsonLoose lança JsonOutputError para lixo ou vazio", () => {
  assert.throws(() => parseJsonLoose("não é json"), JsonOutputError);
  assert.throws(() => parseJsonLoose(""), JsonOutputError);
  assert.throws(() => parseJsonLoose('{"a": 1'), JsonOutputError);
});

test("validateSchema aprova um veredito válido", () => {
  const ok = { verdict: "refuted", confidence: 0.9, explanation: "x", citations: ["E1"] };
  assert.deepEqual(validateSchema(ok, VERDICT_SCHEMA), []);
});

test("validateSchema aponta enum, tipo e campo ausente", () => {
  const bad = { verdict: "maybe", confidence: "alta", citations: "E1" };
  const errors = validateSchema(bad, VERDICT_SCHEMA);
  assert.ok(errors.some((e) => e.includes("$.verdict")));
  assert.ok(errors.some((e) => e.includes("$.confidence")));
  assert.ok(errors.some((e) => e.includes("$.explanation")));
  assert.ok(errors.some((e) => e.includes("$.citations")));
});

test("validateSchema valida itens de array aninhados", () => {
  const value = { page_summary: "", language: "pt", claims: [{ text: "a", context: "b" }] };
  const errors = validateSchema(value, EXTRACT_SCHEMA);
  assert.deepEqual(errors, ["$.claims[0].search_query: campo obrigatório ausente"]);
});
