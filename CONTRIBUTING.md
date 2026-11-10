# Contribuir

Use Node 22+ (CI em Node 22 e 24). A extensão não tem build nem dependências de npm.

```bash
npm run check
npm test
```

Para alterações de interface, rode `npm run test:e2e` com Chrome/Chromium instalado; `CHROME_PATH` permite indicar outro executável. Esse teste usa Wikipedia e APIs reais com chaves falsas para validar erros, mas simula as respostas do modelo. Sem chave válida ele não mede a precisão do produto. Use `--docs` somente ao atualizar as imagens intencionalmente.

Inclua passos de reprodução e validação no pull request. Testes de regressão devem reproduzir um comportamento observável; para novos provedores, preserve cancelamento, citações e tratamento de erro.

Nas issues, informe versão do Chrome, provedor/modelo e busca. Use páginas públicas ou trechos fictícios; nunca envie chaves, storage do navegador ou textos privados. Antes de anexar imagens, oculte dados sensíveis.

Código sob MIT; preserve os avisos de licença das fontes incluídas.
