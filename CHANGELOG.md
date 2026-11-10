# Changelog

## 1.2.0 — 2026-11-09

Entrega consolidada para uso pessoal e portfólio.

- Nova interface com fontes em destaque, filtros por veredito, foco preservado, navegação por teclado, fonte Inter local e suporte a modo escuro e painéis de 320 px.
- Aviso recolhível quando a leitura cobre apenas o começo do texto; página e seleção usam o mesmo limite de 12 mil caracteres.
- Corrigido o corte silencioso do prompt em 9 mil caracteres.
- Corrigida a restauração indevida de chaves antigas após apagá-las; limpeza inclui os campos legados.
- ZIP da extensão, documentação de instalação/atualização, screenshots e resultados de validação incluídos.
- Validação: 84 testes automatizados, 38 arquivos sem erro de sintaxe e 25 verificações no Chrome.

### Limites desta entrega

O teste da interface usa busca real e respostas de modelo simuladas. Não há nova métrica de precisão com modelo real. É necessária uma chave própria para usar a extensão; a leitura é heurística e a confiança declarada pelo modelo não é calibrada. Veja [README](README.md#limitações) e [validação](docs/VALIDACAO.md).
