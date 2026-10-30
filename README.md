# ClaimCheck

[![CI](https://github.com/ArthurGoon/ClaimCheck/actions/workflows/ci.yml/badge.svg)](https://github.com/ArthurGoon/ClaimCheck/actions/workflows/ci.yml)

Extensão do Chrome que checa afirmações factuais da página que você está lendo. Um LLM separa as afirmações verificáveis do texto, um agente de busca junta evidências (API da Wikipedia em PT e EN e um buscador web opcional) e o LLM dá um veredito para cada afirmação: **confirmado**, **refutado** ou **evidência insuficiente**, com uma confiança e as fontes citadas. As citações sempre apontam para trechos que o agente realmente encontrou; se o modelo não cita nada válido, o veredito cai para "evidência insuficiente".

## Como funciona

```
página ──► extração (LLM, JSON com schema)
               │  até N afirmações + consulta de busca + resumo da página
               ▼
           busca de evidências (por afirmação, em paralelo)
               │  Wikipedia EN/PT (API oficial) + Brave | Tavily | DuckDuckGo HTML
               │  ranqueia por relevância, remove duplicatas, limita por domínio
               │  lê as 2 melhores páginas e guarda só os trechos ligados à afirmação
               ▼
           veredito (LLM, JSON com schema)
               │  supported | refuted | not_enough_evidence + confiança + ids [E1, E3]
               ▼
           pós-processamento: ids inválidos descartados, veredito sem citação rebaixado
```

Falhas são tratadas sem derrubar a verificação inteira: timeout e retry com backoff (respeitando `Retry-After`) em 429 e 5xx, provedor de busca que falha vira aviso no painel, afirmação que dá erro aparece como erro e as outras seguem.

## Instalação

Não tem build.

1. Clone o repositório.
2. Abra `chrome://extensions`, ative o **Modo do desenvolvedor** e clique em **Carregar sem compactação**.
3. Selecione a pasta do repositório (a que tem o `manifest.json`).
4. Clique no ícone do ClaimCheck para abrir o painel lateral e depois em **Configurações**.

Nas configurações você escolhe o provedor de LLM, cola a API key, opcionalmente troca o modelo (campo livre) e escolhe a busca web. As chaves ficam em `chrome.storage.local`, só no seu navegador, e as chamadas vão direto do navegador para a API de cada provedor.

## Provedores

LLM (uma chave do provedor escolhido):

| Provedor | Modelo padrão | Saída estruturada |
|----------|---------------|-------------------|
| OpenAI | `gpt-6-luna` | `response_format` com `json_schema` strict |
| Anthropic | `claude-haiku-5-5` | `output_config.format` com `json_schema` |
| Gemini | `gemini-3.8-flash` | `responseMimeType` + `responseSchema` |
| DeepSeek | `deepseek-flash` | JSON mode, com o schema descrito no prompt |

Os modelos padrão foram conferidos na documentação de cada provedor em outubro de 2026. Como os nomes mudam rápido, o modelo é um campo de texto livre nas opções. Se um provedor recusar o schema (HTTP 400), a chamada é repetida pedindo JSON só pelo prompt. Toda resposta é validada localmente contra o schema e, se vier malformada, o modelo recebe uma segunda chance com o erro apontado.

Busca na web:

| Opção | Chave | Observação |
|-------|-------|------------|
| DuckDuckGo HTML | não | padrão; lê a versão HTML, não é API oficial. Pode ser bloqueado (veja limitações) |
| Brave Search API | sim | API oficial, mais estável |
| Tavily | sim | API oficial, mais estável |
| Só Wikipedia | não | sem busca na web aberta |

A Wikipedia (EN sempre, PT quando a afirmação está em português) é consultada em todos os casos, pela API oficial.

## Avaliação

O repositório tem um eval offline em `eval/`: 24 afirmações rotuladas à mão, metade em português e metade em inglês, divididas igualmente entre `supported`, `refuted` e `not_enough_evidence` (fatos privados, eventos futuros, números sem fonte). O script roda a mesma busca e o mesmo veredito da extensão (pula só a extração, já que as afirmações vêm prontas) e mostra acurácia, macro-F1, precisão e recall por classe, acurácia por idioma, cobertura de evidências e a matriz de confusão. O resultado completo de cada rodada vai para `eval/results/` (ignorado pelo git).

```bash
OPENAI_API_KEY=... node eval/run.mjs
ANTHROPIC_API_KEY=... node eval/run.mjs --provider anthropic
GEMINI_API_KEY=... BRAVE_API_KEY=... node eval/run.mjs --provider gemini --search brave
node eval/run.mjs --help   # --model, --search, --limit, --ids, --concurrency
```

Ainda não publiquei números aqui porque não rodei o eval com uma chave de LLM nesta versão. Os resultados dependem do modelo, do buscador e do dia (a web muda), então a ideia é rodar e anotar junto com o provedor, o modelo e a busca usados.

Testes unitários (sem rede, com `fetch` simulado) cobrem parsing de JSON, validação de schema, pós-processamento da extração, ranqueamento de evidências, parsers dos buscadores, adaptadores de cada LLM, retry, veredito e métricas:

```bash
npm test          # node --test, Node 22+
npm run check     # node --check em todos os arquivos
```

O CI do GitHub roda os dois a cada push.

## Estrutura

```
background.js        service worker: lê configurações, injeta o extrator, roda o pipeline
content.js           responde ao pedido de extração na página
sidepanel.*          painel lateral (resultado, citações, evidências consultadas)
options.*            configurações
lib/
  pipeline.js        extração -> evidências -> veredito (roda igual no navegador e no Node)
  prompts.js         todos os prompts
  schemas.js         JSON Schemas das saídas do LLM
  llm.js             adaptadores OpenAI, Anthropic, Gemini e DeepSeek + validação e retry
  search/            Wikipedia, Brave, Tavily, DuckDuckGo e o agente que junta tudo
  evidence.js        tokenização, ranqueamento, seleção de trechos
  verify.js          normalização do veredito e checagem das citações
  claims.js          limpeza da lista de afirmações extraídas
  http.js / json.js  fetch com timeout e retry; parsing tolerante e validador de schema
eval/                dataset rotulado, métricas e script de avaliação
test/                testes com node --test
```

## Decisões de projeto

- **Três rótulos em vez de quatro.** A versão anterior tinha também "impreciso". Tirei para deixar as classes mutuamente exclusivas e o eval mais fácil de interpretar.
- **Veredito por afirmação.** Uma chamada por afirmação (duas em paralelo) em vez de um lote, para não depender do modelo manter a ordem e para que uma falha afete só uma afirmação.
- **Citação obrigatória.** As evidências recebem ids (`E1`, `E2`...). O modelo devolve ids, não URLs, então não tem como inventar link. Confirmar ou refutar sem citar um id válido vira "evidência insuficiente" com confiança no máximo 0,3.
- **Sem evidência, sem LLM.** Se a busca não acha nada relevante, o veredito é "evidência insuficiente" direto, sem gastar chamada.
- **APIs oficiais primeiro.** O scraping de Bing e Google News da versão anterior foi removido. O DuckDuckGo HTML ficou só como opção sem chave, e uma falha nele aparece como aviso.
- **Ranqueamento simples e explicável.** Sobreposição de termos entre afirmação e resultado (título pesa mais), bônus pequeno para fontes de referência, no máximo 2 resultados por domínio. Das páginas lidas, só vão para o LLM as frases que compartilham termos com a afirmação.
- **Injeção sob demanda.** O extrator de texto só entra na página quando você clica em Verificar, em vez de rodar em todas as abas.
- **Mesmo código na extensão e no eval.** `lib/` não usa a API `chrome.*`, então o eval mede exatamente o pipeline que roda no navegador.

## Limitações

- O veredito é tão bom quanto a evidência. Fatos muito recentes ou pouco cobertos tendem a sair como "evidência insuficiente", principalmente sem Brave ou Tavily.
- O DuckDuckGo HTML não é uma API: num teste com Chrome headless ele respondeu com a página de verificação anti-robô (HTTP 202) e a busca ficou só na Wikipedia. Para uso sério, configure Brave ou Tavily.
- Muitos sites bloqueiam leitura automática (403) ou dependem de JavaScript; nesses casos o agente usa só o snippet da busca.
- A extração do texto da página é heurística e às vezes pega menu ou sumário junto com o artigo.
- A confiança é a que o modelo declara, sem calibração. O eval mede acerto do rótulo, não calibração.
- O dataset do eval é pequeno (24 itens) e foi montado por mim; serve para comparar versões e provedores, não como benchmark.
- A chave do LLM fica no navegador e é enviada direto ao provedor. Para a Anthropic isso exige o header `anthropic-dangerous-direct-browser-access`, o que é aceitável aqui porque a chave é do próprio usuário.

## Licença

MIT
