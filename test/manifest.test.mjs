import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("manifest é MV3 válido e aponta para arquivos que existem", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  const files = [
    manifest.background.service_worker,
    manifest.side_panel.default_path,
    manifest.options_page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ];
  for (const file of files) assert.ok(existsSync(new URL(file, root)), `${file} não existe`);
});

test("arquivos injetados pelo background existem", () => {
  const background = read("background.js");
  const injected = [...background.matchAll(/files:\s*\[([^\]]+)\]/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  assert.ok(injected.length > 0);
  for (const file of injected) assert.ok(existsSync(new URL(file, root)), `${file} não existe`);
});

test("scripts referenciados nas páginas HTML existem", () => {
  for (const page of ["sidepanel.html", "options.html"]) {
    for (const [, src] of read(page).matchAll(/<script[^>]+src="([^"]+)"/g)) {
      assert.ok(existsSync(new URL(src, root)), `${page}: ${src} não existe`);
    }
  }
});

test("módulos de lib/ não dependem da API chrome (rodam no Node)", () => {
  const walk = (dir) =>
    readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(`${dir}${d.name}/`) : d.name.endsWith(".js") ? [`${dir}${d.name}`] : []
    );
  for (const file of walk("lib/")) {
    if (file === "lib/extract.js") continue; // content script, roda na página
    assert.ok(!/\bchrome\./.test(read(file)), `${file} usa chrome.*`);
  }
});

test("background importa os módulos sem erro de resolução", async () => {
  // Importa as dependências do background (que não usam chrome.*).
  await import("../lib/pipeline.js");
  await import("../lib/providers.js");
});
