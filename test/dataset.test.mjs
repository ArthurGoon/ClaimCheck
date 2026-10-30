import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LABELS } from "../eval/metrics.mjs";

const dataset = JSON.parse(readFileSync(new URL("../eval/claims.json", import.meta.url), "utf8"));

test("dataset do eval tem ids únicos, rótulos válidos e os dois idiomas", () => {
  assert.ok(dataset.length >= 20 && dataset.length <= 30);
  assert.equal(new Set(dataset.map((d) => d.id)).size, dataset.length);
  for (const item of dataset) {
    assert.ok(LABELS.includes(item.label), `${item.id}: rótulo ${item.label}`);
    assert.ok(["pt", "en"].includes(item.lang), `${item.id}: idioma ${item.lang}`);
    assert.ok(item.claim.length > 10);
  }
});

test("dataset é balanceado entre classes e idiomas", () => {
  const count = (fn) => dataset.filter(fn).length;
  const perLabel = LABELS.map((l) => count((d) => d.label === l));
  assert.ok(Math.max(...perLabel) - Math.min(...perLabel) <= 2, `classes: ${perLabel}`);
  assert.ok(Math.abs(count((d) => d.lang === "pt") - count((d) => d.lang === "en")) <= 2);
});
