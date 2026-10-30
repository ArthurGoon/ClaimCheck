import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMetrics, confusionMatrix, formatMatrix } from "../eval/metrics.mjs";

const pairs = [
  { expected: "supported", predicted: "supported" },
  { expected: "supported", predicted: "not_enough_evidence" },
  { expected: "refuted", predicted: "refuted" },
  { expected: "refuted", predicted: "supported" },
  { expected: "not_enough_evidence", predicted: "not_enough_evidence" },
  { expected: "not_enough_evidence", predicted: "error" },
];

test("matriz de confusão conta linhas por rótulo esperado, incluindo erros", () => {
  const m = confusionMatrix(pairs);
  assert.deepEqual(m.supported, { supported: 1, refuted: 0, not_enough_evidence: 1, error: 0 });
  assert.deepEqual(m.refuted, { supported: 1, refuted: 1, not_enough_evidence: 0, error: 0 });
  assert.deepEqual(m.not_enough_evidence, { supported: 0, refuted: 0, not_enough_evidence: 1, error: 1 });
});

test("acurácia, precisão, recall e macro-F1", () => {
  const r = computeMetrics(pairs);
  assert.equal(r.total, 6);
  assert.equal(r.correct, 3);
  assert.equal(r.accuracy, 0.5);
  // supported: previsto 2 vezes, 1 certo; suporte 2.
  assert.equal(r.perClass.supported.precision, 0.5);
  assert.equal(r.perClass.supported.recall, 0.5);
  // refuted: previsto 1 vez, certo; suporte 2.
  assert.equal(r.perClass.refuted.precision, 1);
  assert.equal(r.perClass.refuted.recall, 0.5);
  const f1Refuted = (2 * 1 * 0.5) / 1.5;
  assert.ok(Math.abs(r.perClass.refuted.f1 - f1Refuted) < 1e-9);
  const expectedMacro = (0.5 + f1Refuted + r.perClass.not_enough_evidence.f1) / 3;
  assert.ok(Math.abs(r.macroF1 - expectedMacro) < 1e-9);
});

test("formatMatrix gera uma linha por rótulo", () => {
  const text = formatMatrix(confusionMatrix(pairs));
  assert.equal(text.split("\n").length, 4);
});
