import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExtractPrompt } from "../lib/prompts.js";

test("extração inclui fatos depois de 9 mil caracteres, até o limite anunciado de 12 mil", () => {
  const visibleFact = "A construção começou em 1961.";
  const outsideLimit = "ESTE TRECHO FICA FORA DO LIMITE";
  const prompt = buildExtractPrompt({
    text: "a".repeat(9500) + visibleFact + "b".repeat(3000) + outsideLimit,
    maxClaims: 5,
  });
  assert.ok(prompt.includes(visibleFact));
  assert.ok(!prompt.includes(outsideLimit));
});
