import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeVerdict, normalizeVerdictPayload, NO_CITATION_CONFIDENCE_CAP } from "../lib/verify.js";

const evidence = [
  { id: "E1", title: "Berlin Wall", url: "https://en.wikipedia.org/wiki/Berlin_Wall", domain: "en.wikipedia.org", provider: "wikipedia-en" },
  { id: "E2", title: "Fall of the wall", url: "https://example.org/fall", domain: "example.org", provider: "duckduckgo" },
];

test("normalizeVerdictPayload aceita sinônimos e confiança em porcentagem", () => {
  const out = normalizeVerdictPayload({ verdict: "TRUE", confidence: 85, citations: "E1, E2" });
  assert.equal(out.verdict, "supported");
  assert.equal(out.confidence, 0.85);
  assert.deepEqual(out.citations, ["E1", "E2"]);
  assert.equal(out.explanation, "");

  assert.equal(normalizeVerdictPayload({ verdict: "Not enough evidence" }).verdict, "not_enough_evidence");
  assert.equal(normalizeVerdictPayload({ verdict: "falso" }).verdict, "refuted");
  assert.equal(normalizeVerdictPayload({ verdict: false }).verdict, "refuted");
  assert.equal(normalizeVerdictPayload({ confidence: "0.4" }).confidence, 0.4);
  assert.equal(normalizeVerdictPayload({ confidence: 7 }).confidence, 0.07);
  assert.equal(normalizeVerdictPayload({ confidence: -2 }).confidence, 0);
});

test("finalizeVerdict mapeia citações para as evidências reais", () => {
  const out = finalizeVerdict({ verdict: "refuted", confidence: 0.9, explanation: "Caiu em 1989.", citations: ["E2", "e1", "E2"] }, evidence);
  assert.equal(out.verdict, "refuted");
  assert.equal(out.confidence, 0.9);
  assert.deepEqual(
    out.citations.map((c) => [c.id, c.url]),
    [
      ["E2", "https://example.org/fall"],
      ["E1", "https://en.wikipedia.org/wiki/Berlin_Wall"],
    ]
  );
});

test("finalizeVerdict descarta ids inventados e aceita formatos [E1] e 1", () => {
  const out = finalizeVerdict({ verdict: "supported", confidence: 0.7, explanation: "", citations: ["E9", "[E1]", "2"] }, evidence);
  assert.deepEqual(out.citations.map((c) => c.id), ["E1", "E2"]);
});

test("veredito sem citação válida vira not_enough_evidence com confiança limitada", () => {
  const out = finalizeVerdict({ verdict: "supported", confidence: 0.95, explanation: "Confia em mim.", citations: ["E7"] }, evidence);
  assert.equal(out.verdict, "not_enough_evidence");
  assert.equal(out.confidence, NO_CITATION_CONFIDENCE_CAP);
  assert.equal(out.citations.length, 0);
  assert.equal(out.notes.length, 1);
});

test("not_enough_evidence sem citação é aceito como está", () => {
  const out = finalizeVerdict({ verdict: "not_enough_evidence", confidence: 0.6, explanation: "Nada.", citations: [] }, evidence);
  assert.equal(out.verdict, "not_enough_evidence");
  assert.equal(out.confidence, 0.6);
  assert.deepEqual(out.notes, []);
});

test("rótulo desconhecido e payload vazio caem em not_enough_evidence", () => {
  assert.equal(finalizeVerdict({ verdict: "talvez", citations: ["E1"] }, evidence).verdict, "not_enough_evidence");
  assert.equal(finalizeVerdict(null, evidence).verdict, "not_enough_evidence");
});
