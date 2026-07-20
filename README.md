# ClaimCheck

Checador de fatos na web — extensão Chrome com **agente de busca próprio**.

Uma API key de LLM. A busca é sempre a mesma, independente do provedor.

## Como funciona

```
Página → LLM extrai claims → Agente ClaimCheck busca na web → LLM verifica com evidências
```

### Agente de busca (nosso)

Para cada claim, o agente:

1. Gera queries de busca otimizadas
2. Busca em **Bing + Wikipedia (EN/PT) + DuckDuckGo** em paralelo
3. **Lê o conteúdo** das melhores páginas encontradas
4. Entrega evidências reais para o LLM dar o veredito

O LLM (OpenAI, DeepSeek ou Gemini) só faz duas coisas: **extrair claims** e **verificar** com as evidências. A busca é 100% do ClaimCheck.

## Instalação

1. `chrome://extensions` → Modo do desenvolvedor
2. Carregar pasta `claimcheck/`
3. Opções → escolher provedor → colar API key

## Provedores suportados

| Provedor | Modelo | Onde criar key |
|----------|--------|----------------|
| DeepSeek | deepseek-chat | platform.deepseek.com |
| Gemini | gemini-2.0-flash | aistudio.google.com |
| OpenAI | gpt-4o-mini | platform.openai.com |

## Estrutura

```
lib/
  search-agent.js   # agente de busca (core do produto)
  verify.js         # verificação com evidências
  prompts.js
  providers.js
```

## Licença

MIT
