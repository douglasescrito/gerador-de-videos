# Minerador de prompts Grok — opcional

O gerador de imagem, vídeo, voz e música usa suas próprias sessões Google.
O minerador Grok é um recurso separado. Sem `--live true`, ele produz variações
locais de teste, identificadas no recibo como `executionMode: offline`.

```powershell
npm run prompt:mine -- --brief "Formas geométricas em movimento" --media video --count 3
```

A execução real exige uma sessão própria do X/Grok com acesso ao serviço.
O leitor existente procura credenciais genéricas do Windows chamadas
`x-media-fetcher:primary:cookies` e, como alternativa, `x-media-fetcher:local:cookies`.
O valor esperado é o JSON dos cookies codificado em Base64, com objetos que
contenham `name` e `value`; a sessão precisa incluir `auth_token` e `ct0` válidos.
Esses valores devem vir da sessão do próprio usuário, nunca do repositório ou
de outra pessoa. Não cole cookies no chat, em arquivos do projeto ou em comandos
que fiquem no histórico. O instalador do gerador não configura esse cofre opcional.

Há duas rotas existentes:

- HTTP, para `grok-3` e `grok-3-latest`: exige um módulo compatível que exporte
  `askGrokDirect(prompt, options)`. Indique o arquivo em `STUDIO_GROK_CLIENT` ou
  no campo `grokClient` de `%LOCALAPPDATA%\GeradorDeVideos\installation.json`.
  O cliente externo X MEDIA e seus dados não acompanham esta distribuição.
- Navegador: usa `playwright-core` do gerador e seu Chrome, respeitando
  `CHROME_PATH` ou `chromePath` da configuração local. Não exige uma instalação
  de Playwright em outro projeto.

O parâmetro de modelo da rota de navegador é legado: não há prova nesta
distribuição de que a interface remota seleciona exatamente esse modelo.
Cookies presentes também não comprovam acesso remoto. As rotas reais não foram
revalidadas nesta preparação; não considerar o diagnóstico local uma prova de
geração. Uma resposta real sem prompts reconhecíveis gera erro, sem substituição
por conteúdo sintético ou repetição automática pelo minerador.

```powershell
npm run prompt:mine -- --brief "Minha direção" --media video --model grok-3-latest --live true
```

Esse comando seleciona execução real. Não existe confirmação de gasto.
Testes com `NODE_ENV=test` bloqueiam chamadas reais antes de ler a sessão.
