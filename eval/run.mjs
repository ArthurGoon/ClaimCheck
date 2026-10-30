#!/usr/bin/env node
// Eval offline do ClaimCheck: roda busca + veredito em claims rotulados e mede o resultado.
//
// Uso:
//   OPENAI_API_KEY=... node eval/run.mjs
//   ANTHROPIC_API_KEY=... node eval/run.mjs --provider anthropic --search none
//   node eval/run.mjs --provider gemini --model gemini-3.6-flash --limit 6
//
// Opções:
//   --provider openai|anthropic|gemini|deepseek   (padrão: CLAIMCHECK_PROVIDER ou o primeiro com chave no ambiente)
//   --model <nome>                                (padrão: modelo padrão do provedor)
//   --search duckduckgo|brave|tavily|none         (padrão: brave/tavily se houver chave, senão duckduckgo)
//   --limit N        roda só os N primeiros claims
//   --ids a,b,c      roda só esses ids
//   --concurrency N  claims em paralelo (padrão 2)
//   --dataset path   arquivo de claims (padrão eval/claims.json)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checkClaim, mapWithConcurrency } from "../lib/pipeline.js";
import { LLM_PROVIDERS, SEARCH_PROVIDERS, resolveModel } from "../lib/providers.js";
import { computeMetrics, formatMatrix, LABELS } from "./metrics.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    provider: { type: "string" },
    model: { type: "string" },
    search: { type: "string" },
    limit: { type: "string" },
    ids: { type: "string" },
    concurrency: { type: "string", default: "2" },
    dataset: { type: "string", default: join(here, "claims.json") },
    help: { type: "boolean", short: "h" },
  },
});

if (args.help) {
  // Reaproveita o comentário do topo deste arquivo como ajuda.
  const header = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//"));
  console.log(header.map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}

const env = process.env;
const provider =
  args.provider || env.CLAIMCHECK_PROVIDER || Object.values(LLM_PROVIDERS).find((p) => env[p.envKey])?.id || "";
if (!LLM_PROVIDERS[provider]) {
  console.error("Nenhum provedor de LLM configurado.");
  console.error("Defina uma destas variáveis: " + Object.values(LLM_PROVIDERS).map((p) => p.envKey).join(", "));
  process.exit(2);
}
const apiKey = env[LLM_PROVIDERS[provider].envKey];
if (!apiKey) {
  console.error(`Falta ${LLM_PROVIDERS[provider].envKey} no ambiente.`);
  process.exit(2);
}

const searchProvider = args.search || env.CLAIMCHECK_SEARCH || (env.BRAVE_API_KEY ? "brave" : env.TAVILY_API_KEY ? "tavily" : "duckduckgo");
if (!SEARCH_PROVIDERS[searchProvider]) {
  console.error(`Busca desconhecida: ${searchProvider}`);
  process.exit(2);
}
const searchKeyVar = SEARCH_PROVIDERS[searchProvider].envKey;
const searchApiKey = searchKeyVar ? env[searchKeyVar] || "" : "";
if (SEARCH_PROVIDERS[searchProvider].needsKey && !searchApiKey) {
  console.error(`A busca ${searchProvider} precisa de ${searchKeyVar}.`);
  process.exit(2);
}

const settings = {
  llmProvider: provider,
  llmApiKey: apiKey,
  llmModel: args.model || env.CLAIMCHECK_MODEL || "",
  searchProvider,
  searchApiKey,
};

let dataset = JSON.parse(readFileSync(args.dataset, "utf8"));
if (args.ids) {
  const wanted = new Set(args.ids.split(","));
  dataset = dataset.filter((d) => wanted.has(d.id));
}
if (args.limit) dataset = dataset.slice(0, Number(args.limit));

const model = resolveModel(settings);
console.log(`ClaimCheck eval: ${dataset.length} claims · LLM ${provider}/${model} · busca ${searchProvider} + Wikipedia\n`);

const startedAt = new Date();
const rows = await mapWithConcurrency(dataset, Number(args.concurrency) || 2, async (item) => {
  let result;
  try {
    result = await checkClaim({ claim: item.claim, lang: item.lang, settings });
  } catch (err) {
    result = { verdict: "error", confidence: 0, explanation: err?.message || String(err), citations: [], evidence: [], warnings: [] };
  }
  const row = {
    id: item.id,
    lang: item.lang,
    claim: item.claim,
    expected: item.label,
    predicted: result.verdict,
    confidence: result.confidence,
    explanation: result.explanation,
    citations: (result.citations || []).map((c) => c.url),
    evidenceCount: (result.evidence || []).length,
    warnings: result.warnings || [],
    notes: result.notes || [],
    elapsedMs: result.elapsedMs ?? null,
  };
  const mark = row.expected === row.predicted ? "✓" : "✗";
  console.log(
    `${mark} ${row.id.padEnd(10)} esperado=${row.expected.padEnd(19)} previsto=${String(row.predicted).padEnd(19)} conf=${(row.confidence ?? 0).toFixed(2)} evid=${row.evidenceCount}`
  );
  if (row.predicted === "error") console.log(`    erro: ${row.explanation}`);
  return row;
});

const metrics = computeMetrics(rows);
const byLang = {};
for (const lang of [...new Set(rows.map((r) => r.lang))]) {
  const subset = rows.filter((r) => r.lang === lang);
  byLang[lang] = computeMetrics(subset).accuracy;
}
const withEvidence = rows.filter((r) => r.evidenceCount > 0).length;
const decided = rows.filter((r) => r.predicted === "supported" || r.predicted === "refuted");
const latencies = rows.map((r) => r.elapsedMs).filter((x) => Number.isFinite(x));
const pct = (x) => `${(x * 100).toFixed(1)}%`;

console.log(`\nAcurácia: ${pct(metrics.accuracy)} (${metrics.correct}/${metrics.total})`);
console.log(`Macro-F1: ${metrics.macroF1.toFixed(3)}`);
for (const label of LABELS) {
  const c = metrics.perClass[label];
  console.log(`  ${label.padEnd(20)} P=${c.precision.toFixed(2)} R=${c.recall.toFixed(2)} F1=${c.f1.toFixed(2)} n=${c.support}`);
}
console.log(`Acurácia por idioma: ${Object.entries(byLang).map(([l, a]) => `${l} ${pct(a)}`).join(" · ")}`);
console.log(`Claims com ao menos 1 evidência: ${withEvidence}/${rows.length}`);
console.log(`Vereditos supported/refuted com citação: ${decided.filter((r) => r.citations.length).length}/${decided.length}`);
if (latencies.length) {
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  console.log(`Tempo médio por claim: ${(mean / 1000).toFixed(1)} s`);
}
console.log(`\nMatriz de confusão:\n${formatMatrix(metrics.matrix)}`);

const outDir = join(here, "results");
mkdirSync(outDir, { recursive: true });
const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
const outFile = join(outDir, `${stamp}-${provider}-${searchProvider}.json`);
writeFileSync(
  outFile,
  JSON.stringify({ startedAt, provider, model, searchProvider, dataset: args.dataset, metrics, byLang, rows }, null, 2)
);
console.log(`\nResultado completo em ${outFile}`);
