#!/usr/bin/env node
// Roda a extensão de verdade num Chrome headless, numa página real, com busca real
// (Wikipedia) e o MODELO SIMULADO (lib/mock-llm.js), e tira screenshots do painel.
// Serve como teste ponta a ponta da interface sem precisar de chave de LLM.
//
// Uso:
//   node scripts/screenshots.mjs                 # salva em docs/screenshots/
//   node scripts/screenshots.mjs --out /tmp/x    # outra pasta
//   node scripts/screenshots.mjs --headful       # abre a janela (útil para depurar)
//
// Precisa de Google Chrome ou Chromium instalado (CHROME_PATH para outro caminho) e de rede.

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { launchChrome, loadExtension, screenshot, CHROME_CANDIDATES } from "./cdp.mjs";
import { SCENARIOS } from "./scenarios.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values: args } = parseArgs({
  options: {
    out: { type: "string", default: join(root, "docs", "screenshots") },
    headful: { type: "boolean", default: false },
    scenario: { type: "string", default: "muro" },
  },
});

const PANEL = { width: 380, height: 900 };
const PAGE = { width: 1060, height: 900 };
const outDir = resolve(args.out);
mkdirSync(outDir, { recursive: true });
const scenario = SCENARIOS[args.scenario];
if (!scenario) throw new Error(`cenário desconhecido: ${args.scenario}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("·", ...a);
const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}`);
}

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
// Se algo travar, não fica pendurado para sempre.
setTimeout(() => {
  console.error("tempo total esgotado");
  process.exit(1);
}, 6 * 60_000).unref();
const browser = await launchChrome({ chromePath, headless: !args.headful });

try {
  const extId = await loadExtension(browser, root);
  log("extensão carregada", extId);
  const swInfo = await browser.waitForTarget((t) => t.type === "service_worker" && t.url.includes(extId));
  const sw = await browser.session(swInfo.targetId);
  const storage = (code) => sw.evaluate(`(async () => { ${code} })()`);

  // Página real.
  const page = await browser.openPage(scenario.url, PAGE);
  await sleep(1500);
  const tabId = await sw.evaluate(
    `chrome.tabs.query({}).then((tabs) => tabs.find((t) => t.url.startsWith(${JSON.stringify(scenario.url.split("#")[0])}))?.id)`
  );
  check("página real abriu", Boolean(tabId), scenario.url);

  // Painel aberto como aba comum, com a largura de um painel lateral, fixado na aba da página.
  const panel = await browser.openPage(`chrome-extension://${extId}/sidepanel.html?tab=${tabId}`, PANEL);
  await sleep(500);
  const $ = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
  const click = (sel) => panel.evaluate(`${$(sel)}.click()`);
  const text = (sel) => panel.evaluate(`${$(sel)}?.innerText || ""`);
  const type = (sel, value) =>
    panel.evaluate(`(() => { const el = ${$(sel)}; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const waitFor = async (expr, timeoutMs = 60_000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await panel.evaluate(expr).catch(() => false)) return true;
      await sleep(150);
    }
    throw new Error(`timeout esperando: ${expr}`);
  };
  const shot = async (name, target = panel) => {
    const file = await screenshot(target, join(outDir, `${name}.png`));
    log("screenshot", file);
    return file;
  };

  // 1. Primeira execução: sem chave, o painel abre na configuração.
  check("sem chave abre a configuração", (await text("h1")).includes("Configure"));
  await shot("01-onboarding");

  // Chave falsa contra a OpenRouter de verdade: testa o caminho de erro real (401).
  await type("#key-input", "sk-or-v1-chave-falsa-para-teste-0000000000");
  await click("#test-btn");
  await waitFor(`!${$("#test-status")}.classList.contains("pending") && ${$("#test-status")}.textContent.length > 0`, 30_000);
  const realStatus = await text("#test-status");
  check("OpenRouter real recusa chave falsa com mensagem clara", /recusou a chave/.test(realStatus), realStatus);
  await shot("02-onboarding-chave-recusada");

  // A partir daqui o modelo é simulado.
  await storage(`await chrome.storage.local.set({ claimcheckDevMock: ${JSON.stringify(scenario.mock)} });`);
  await click("#test-btn");
  await waitFor(`${$("#test-status")}.classList.contains("ok")`);
  check("teste de conexão ok (modelo simulado)", true, await text("#test-status"));
  await shot("03-onboarding-ok");
  await click("#save-btn");
  await waitFor(`!!${$("#verify-btn")}`);
  check("salvar leva para a tela principal", true);
  await shot("04-pronto");

  // 2. Verificação da página inteira.
  await click("#verify-btn");
  await waitFor(`document.querySelectorAll(".claim.pending").length > 0 && document.querySelectorAll(".claim:not(.pending)").length > 0`);
  await shot("05-progresso");
  await waitFor(`!document.querySelector(".stepper") && !!document.querySelector(".summary")`, 120_000);
  const verdicts = await panel.evaluate(`[...document.querySelectorAll(".claim .chip")].map((c) => c.innerText.trim())`);
  check("resultado com todas as afirmações", verdicts.length === scenario.mock.extract.claims.length, verdicts.join(", "));
  const sources = await panel.evaluate(`document.querySelectorAll(".source").length`);
  check("vereditos citam fontes reais encontradas pela busca", sources > 0, `${sources} fontes citadas`);
  await panel.evaluate(`window.scrollTo(0, 0)`);
  await shot("06-resultado");
  const saved = await sw.evaluate(`chrome.storage.session.get("report:${tabId}").then((r) => r["report:${tabId}"])`);
  writeFileSync(join(outDir, "report.json"), JSON.stringify(saved, null, 2));

  // Destaque na página da primeira afirmação: composição página + painel, como fica no Chrome.
  const locate = async (index) => {
    await page.send("Page.bringToFront");
    await click(`[data-locate='${index}']`);
    await sleep(1500);
    return page.evaluate(`CSS.highlights.has("claimcheck") ? String([...CSS.highlights.get("claimcheck")][0]) : ""`);
  };
  await locate(0);
  await shot("07-destaque-pagina", page);
  await compose(join(outDir, "07-destaque-pagina.png"), join(outDir, "06-resultado.png"), join(outDir, "claimcheck.png"));

  // Afirmação inconclusiva com as fontes abertas e o trecho destacado na página.
  const k = scenario.highlightIndex;
  await click(`[data-toggle='${k}']`);
  await sleep(200);
  await panel.evaluate(
    `window.scrollTo(0, document.querySelectorAll(".claim")[${k}].getBoundingClientRect().top + window.scrollY - 64)`
  );
  await shot("08-evidencias");
  const highlighted = await locate(k);
  check("'Mostrar na página' destaca o trecho citado", highlighted.length > 20, highlighted.slice(0, 80));
  await shot("09-destaque-inconclusiva", page);
  await compose(join(outDir, "09-destaque-inconclusiva.png"), join(outDir, "08-evidencias.png"), join(outDir, "claimcheck-fontes.png"));
  await click(`[data-toggle='${k}']`);

  // Modo escuro.
  await panel.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await panel.evaluate(`window.scrollTo(0, 0)`);
  await sleep(300);
  await shot("10-resultado-escuro");
  await panel.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

  // 3. Só a seleção: seleciona um parágrafo real da página.
  const selected = await page.evaluate(`(() => {
    const p = [...document.querySelectorAll("#mw-content-text p, article p, main p")].find((el) => el.innerText.length > 200);
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return sel.toString().length;
  })()`);
  await click("[data-mode='selection']");
  await click("#verify-btn");
  await waitFor(`/caracteres/.test(document.querySelector(".stepper")?.innerText || "")`);
  const chars = await panel.evaluate(`(document.querySelector(".stepper").innerText.match(/([\\d.]+) caracteres/) || [])[1]`);
  check("modo seleção lê só o trecho selecionado", Number(String(chars).replace(/\./g, "")) <= selected + 5, `${chars} de ${selected} caracteres`);
  await waitFor(`!!document.querySelector(".summary")`, 120_000);

  // Sem seleção: erro amigável.
  await page.evaluate(`getSelection().removeAllRanges()`);
  await click("#verify-btn");
  await waitFor(`!!document.querySelector(".error-card")`);
  check("seleção vazia vira aviso", (await text(".error-title")) === "Nada selecionado");
  await click("[data-mode='article']");

  // 4. Erro do provedor (chave recusada, simulado com HTTP 401).
  await storage(`await chrome.storage.local.set({ claimcheckDevMock: ${JSON.stringify({ ...scenario.mock, error: { status: 401, message: "invalid key" } })} });`);
  await click("#verify-btn");
  await waitFor(`!!document.querySelector(".error-card")`);
  check("chave recusada mostra erro com ação", (await text(".error-card")).includes("Abrir configurações"), await text(".error-title"));
  await shot("11-erro");

  // 5. Cancelamento no meio.
  await storage(`await chrome.storage.local.set({ claimcheckDevMock: ${JSON.stringify({ ...scenario.mock, delayMs: 3000 })} });`);
  await click("#verify-btn");
  await waitFor(`!!document.querySelector(".stepper")`);
  await sleep(500);
  await click("#verify-btn");
  await sleep(300);
  check("cancelar volta ao estado inicial", (await text("#verify-btn")).trim() === "Verificar");

  // 6. Página interna do navegador.
  const internal = await browser.openPage("chrome://version", { width: 800, height: 600 });
  const internalId = await sw.evaluate(`chrome.tabs.query({}).then((tabs) => tabs.find((t) => t.url.startsWith("chrome://version"))?.id)`);
  const panel2 = await browser.openPage(`chrome-extension://${extId}/sidepanel.html?tab=${internalId}`, PANEL);
  await sleep(400);
  await panel2.evaluate(`document.querySelector("#verify-btn").click()`);
  await sleep(1500);
  const internalError = await panel2.evaluate(`document.querySelector(".error-title")?.innerText || ""`);
  check("página interna mostra erro claro", internalError === "Página não suportada", internalError);
  void internal;

  // 7. Configurações.
  await click("#settings-btn");
  await sleep(200);
  await shot("12-configuracoes");
} catch (err) {
  console.error(err);
  checks.push({ name: "execução sem exceção", ok: false, detail: err.message });
} finally {
  await browser.close();
}

writeFileSync(join(outDir, "checks.json"), JSON.stringify(checks, null, 2));
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} verificações ok`);
process.exit(failed.length ? 1 : 0);

/** Junta página e painel numa imagem só, renderizando um HTML no próprio Chrome. */
async function compose(pagePng, panelPng, outPng) {
  const { readFileSync } = await import("node:fs");
  const b64 = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
  const html = `<!doctype html><html><body style="margin:0;background:#dcdad5;display:flex;align-items:flex-start;padding:24px;gap:0">
    <div style="display:flex;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.18);border:1px solid #c9c7c1">
      <img src="${b64(pagePng)}" style="display:block;width:${PAGE.width}px;height:${PAGE.height}px">
      <img src="${b64(panelPng)}" style="display:block;width:${PANEL.width}px;height:${PANEL.height}px;border-left:1px solid #c9c7c1">
    </div></body></html>`;
  const tmp = join(outDir, ".compose.html");
  writeFileSync(tmp, html);
  const width = PAGE.width + PANEL.width + 48 + 3;
  const height = PAGE.height + 48 + 2;
  const target = await browser.openPage(`file://${tmp}`, { width, height });
  await sleep(500);
  await screenshot(target, outPng);
  const { rmSync } = await import("node:fs");
  rmSync(tmp);
  log("composição", outPng);
}
