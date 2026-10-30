import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeExtractedClaims } from "../lib/claims.js";

test("normaliza o formato do schema", () => {
  const out = normalizeExtractedClaims({
    claims: [{ text: "  Brasília foi inaugurada em 1960.  ", context: "Capital do Brasil", search_query: "Brasilia inauguration 1960" }],
  });
  assert.deepEqual(out, [
    { text: "Brasília foi inaugurada em 1960.", context: "Capital do Brasil", searchQuery: "Brasilia inauguration 1960" },
  ]);
});

test("aceita strings soltas e chaves alternativas", () => {
  const out = normalizeExtractedClaims({
    claims: ["A Torre Eiffel fica em Paris.", { claim: "O Everest tem 8.849 metros.", searchQuery: "Everest height" }],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].searchQuery, "");
  assert.equal(out[1].text, "O Everest tem 8.849 metros.");
  assert.equal(out[1].searchQuery, "Everest height");
});

test("remove duplicados ignorando caixa, acento e pontuação", () => {
  const out = normalizeExtractedClaims({
    claims: [{ text: "Brasília foi inaugurada em 1960." }, { text: "brasilia foi inaugurada em 1960" }],
  });
  assert.equal(out.length, 1);
});

test("descarta vazios, curtos, longos e itens inválidos", () => {
  const out = normalizeExtractedClaims({
    claims: [null, 42, { text: "" }, { text: "Curto." }, { text: "x".repeat(500) }, { text: "Uma afirmação de tamanho normal." }],
  });
  assert.deepEqual(
    out.map((c) => c.text),
    ["Uma afirmação de tamanho normal."]
  );
});

test("respeita o máximo de claims", () => {
  const claims = Array.from({ length: 10 }, (_, i) => ({ text: `Afirmação número ${i} sobre algo.` }));
  assert.equal(normalizeExtractedClaims({ claims }, 3).length, 3);
});

test("payload sem claims devolve lista vazia", () => {
  assert.deepEqual(normalizeExtractedClaims(undefined), []);
  assert.deepEqual(normalizeExtractedClaims({ claims: "nada" }), []);
});
