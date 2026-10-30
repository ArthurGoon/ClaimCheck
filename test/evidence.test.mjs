import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tokenize,
  keywordQuery,
  stripTags,
  htmlToText,
  selectPassages,
  normalizeUrl,
  scoreResult,
  rankEvidence,
} from "../lib/evidence.js";

test("tokenize remove stopwords PT/EN e acentos", () => {
  assert.deepEqual(tokenize("Brasília foi inaugurada em 1960"), ["brasilia", "inaugurada", "1960"]);
  assert.deepEqual(tokenize("The Berlin Wall fell in 1989."), ["berlin", "wall", "fell", "1989"]);
});

test("keywordQuery mantém palavras de conteúdo na ordem original", () => {
  assert.equal(keywordQuery("O Monte Roraima é o ponto mais alto do Brasil."), "Monte Roraima ponto alto Brasil");
});

test("stripTags junta tags inline e decodifica entidades", () => {
  assert.equal(stripTags("A <b>Torre</b> <span class=\"x\">Eiffel</span> &amp; Paris , ok"), "A Torre Eiffel & Paris, ok");
});

test("htmlToText ignora script, estilo e navegação", () => {
  const html = "<html><nav>Menu Home</nav><script>var x=1</script><style>p{}</style><p>Texto útil aqui.</p><footer>rodapé</footer></html>";
  const text = htmlToText(html);
  assert.ok(text.includes("Texto útil aqui"));
  assert.ok(!text.includes("Menu"));
  assert.ok(!text.includes("var x"));
  assert.ok(!text.includes("rodapé"));
});

test("selectPassages escolhe as frases que falam do claim, na ordem original", () => {
  const text =
    "Bem-vindo ao nosso portal de notícias e serviços. " +
    "Brasília foi inaugurada em 21 de abril de 1960 por Juscelino Kubitschek. " +
    "O clima da região é tropical de altitude com duas estações. " +
    "A inauguração de Brasília marcou a transferência da capital do Rio de Janeiro.";
  const out = selectPassages(text, "Brasília foi inaugurada como capital em 1960", 400);
  assert.ok(out.startsWith("Brasília foi inaugurada em 21 de abril de 1960"));
  assert.ok(out.includes("transferência da capital"));
  assert.ok(!out.includes("clima"));
  assert.ok(!out.includes("Bem-vindo"));
});

test("normalizeUrl ignora www, barra final, fragmento e parâmetros de rastreio", () => {
  assert.equal(normalizeUrl("https://www.example.com/a/?utm_source=x#top"), normalizeUrl("https://example.com/a"));
  assert.notEqual(normalizeUrl("https://example.com/a?id=1"), normalizeUrl("https://example.com/a?id=2"));
});

test("scoreResult prefere resultado que cobre os termos do claim", () => {
  const terms = tokenize("Berlin Wall fell 1989");
  const good = scoreResult({ title: "Berlin Wall", text: "The wall fell in November 1989 after weeks of protests.", url: "https://en.wikipedia.org/wiki/Berlin_Wall" }, terms);
  const bad = scoreResult({ title: "Receita de bolo", text: "Misture farinha e ovos por cinco minutos.", url: "https://exemplo.com/bolo" }, terms);
  assert.ok(good > 0.8, `good=${good}`);
  assert.ok(bad < 0.1, `bad=${bad}`);
});

test("rankEvidence deduplica, limita por domínio, filtra irrelevantes e ordena", () => {
  const claim = "Brasília foi inaugurada em 1960";
  const results = [
    { title: "Brasília", text: "Brasília foi inaugurada em 1960.", url: "https://pt.wikipedia.org/wiki/Bras%C3%ADlia", provider: "wikipedia-pt" },
    { title: "Brasília", text: "Brasília foi inaugurada em 1960.", url: "https://pt.wikipedia.org/wiki/Bras%C3%ADlia#hist", provider: "duckduckgo" },
    { title: "Inauguração de Brasília 1960", text: "Brasília inaugurada.", url: "https://a.com/1", provider: "duckduckgo" },
    { title: "Brasília inaugurada", text: "Em 1960 Brasília foi inaugurada.", url: "https://a.com/2", provider: "duckduckgo" },
    { title: "Brasília 1960", text: "inaugurada", url: "https://a.com/3", provider: "duckduckgo" },
    { title: "Futebol", text: "Resultado do jogo de ontem.", url: "https://b.com/x", provider: "duckduckgo" },
    { title: "Sem URL", text: "Brasília 1960", url: "ftp://c.com", provider: "duckduckgo" },
  ];
  const ranked = rankEvidence(results, claim, { limit: 10, perDomain: 2 });
  const urls = ranked.map((r) => r.url);

  assert.equal(urls.filter((u) => u.includes("wikipedia")).length, 1, "duplicata removida");
  assert.equal(urls.filter((u) => u.includes("a.com")).length, 2, "no máximo 2 por domínio");
  assert.ok(!urls.includes("https://b.com/x"), "irrelevante filtrado");
  assert.ok(!urls.some((u) => u.startsWith("ftp")), "só http(s)");
  for (let i = 1; i < ranked.length; i += 1) assert.ok(ranked[i - 1].score >= ranked[i].score);
  assert.ok(ranked.every((r) => r.domain));
});
