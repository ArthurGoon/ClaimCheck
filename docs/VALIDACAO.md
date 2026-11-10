# Validação local — 9 de novembro de 2026

Objetivo desta revisão: uso pessoal confiável e portfólio.

Ambiente: Node 24.21.0 e Google Chrome 157.0.8103.38, Linux.

## Resultado

- `npm test`: **84/84**, sem testes pulados.
- `npm run check`: **38/38** arquivos sem erro de sintaxe.
- `npm run test:e2e`: **25/25** com Chrome headless e extensão carregada de verdade. Página e evidências da Wikipedia reais; respostas de extração/veredito simuladas e identificadas como tal.
- Teste de autenticação com chave falsa contra OpenRouter real e falha da Tavily real. Nenhuma chave válida usada.
- Interface com aviso de leitura parcial inspecionada visualmente.

As seis imagens do README foram atualizadas pelo próprio teste. Os resultados das verificações foram preservados em `docs/e2e-checks.json`.

## Correções verificadas

1. Chaves no formato antigo não reaparecem quando o mapa atual está vazio. O botão de apagar também remove os campos legados do storage. Teste unitário reproduziu a restauração indevida antes da correção; o Chrome confere a remoção e a configuração vazia ao reabrir.
2. O extrator entregava 12 mil caracteres, mas o prompt cortava silenciosamente em 9 mil. Ambos agora respeitam 12 mil. Teste unitário reproduziu a perda de um fato localizado depois dos 9 mil antes da correção.
3. O resultado informa quando a leitura foi parcial e quantos caracteres foram lidos do texto extraído. A seleção também é limitada e informa o corte. Metadados são preservados no resultado da sessão.
4. Novo atalho `npm run test:e2e` e documentação atualizada.

## Limites da validação

Os vereditos desta demonstração são roteirizados. Isso valida busca, interface, armazenamento, destaque, cancelamento e tratamento de erros; **não mede a precisão de um modelo real**. Não há acurácia ou macro-F1 novos a publicar. O conjunto rotulado tem 24 itens e não foi executado com chave válida nesta revisão.

O aviso de leitura parcial se refere ao texto principal que a heurística conseguiu extrair. Não representa todos os caracteres do HTML, nem uma garantia de leitura de cada afirmação da página.

## Próxima validação necessária

Configurar uma chave própria na extensão, usar **Testar conexão**, conferir os vereditos e fontes em algumas páginas reais e executar `eval/run.mjs` com as credenciais definidas no próprio ambiente. Guardar modelo, busca, data, custo observado e métricas junto dos resultados. Não publicar uma taxa de precisão baseada nas respostas simuladas.

## Revisão da interface

Tipografia Inter local, nova hierarquia para começar e explorar resultados, filtros por veredito com foco preservado, identificação explícita de confiança declarada pelo modelo e aviso de leitura parcial recolhível. A ação de refazer a verificação tem menos peso que a leitura dos resultados. Dados de modelo/busca aparecem sob demanda no rodapé; controles de modo e configuração respondem às setas do teclado.

As 25 verificações incluem filtros e restauração dos resultados, foco após filtrar, setas do teclado e painel de 320 px sem rolagem horizontal. Telas de entrada, configuração, progresso, resultado, erro, fontes e modo escuro foram inspecionadas no Chrome. As respostas do modelo continuam simuladas e identificadas na documentação.

## Preparação da release v1.2.0

Versões do pacote e do manifesto alinhadas em 1.2.0; ZIP da extensão validado e instruções de instalação/atualização incluídas. CI configurado em Node 22 e 24. A revisão final repetiu os 84 testes, a checagem de 38 arquivos e as 25 verificações no Chrome.
