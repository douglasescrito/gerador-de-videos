# Gerador de Vídeos — motor e CLI

O CORE reúne o aplicativo Node local, o CLI, renderers, áudio, montagem,
Knowledge Core e adapters de provedores. Para instalar no Windows, comece pelo
[guia da raiz](../LEIA-ME.md) e pela [instalação](docs/INSTALACAO-WINDOWS.md).
Execute os comandos abaixo nesta pasta CORE, depois de instalar as dependências.

## Preparar e abrir

Na raiz do projeto, INSTALAR.ps1 instala pelo lockfile e prepara os recursos
locais. INICIAR.cmd abre o app usando o lançador que verifica a instância do
CORE. Para desenvolvimento, `npm run acervo` inicia o servidor Node diretamente;
confira a URL informada por ele. Não há package.json separado do app nem um
comando npm run app nesta edição.

```powershell
npm run doctor
npm run video -- commands --format json
npm run video -- generate --help
```

O comando `doctor` verifica dependências locais e consulta o endpoint Omni em
`/api/health` (porta 3000 por padrão, configurável por OMNI_ENDPOINT). O app visual
usa outro contrato: `/api/studio-health` na porta 5599. Portanto, `unreachable`
no endpoint Omni não comprova falha do app visual, do Playwright ou do FFmpeg.
O lançador INICIAR.cmd verifica a saúde e o caminho da cópia correta do app.

Leia o [contrato do CLI](docs/AGENT-CONTRACT.md) antes de executar. A ajuda e o
[mapa de capacidades](docs/CAPABILITIES.md) distinguem rotas disponíveis,
experimentais e bloqueadas. Uma capacidade registrada não comprova acesso da
sua conta ao serviço remoto.

## Animação local

Three.js desenha cenas, geometria, materiais, luzes e partículas. Playwright
controla o Chrome headless, executa a cena isolada e captura os frames; FFmpeg
codifica e monta o vídeo. Os pacotes de animação e composição são instalados
pelo lockfile, e seus usos estão no [Three Design Studio](docs/THREE-DESIGN-STUDIO.md).

O [guia de motores locais](docs/MOTORES-LOCAIS.md) reúne presets e contratos de
Three.js, HTML/Canvas, HyperFrames e Remotion. Novos componentes devem integrar
esses renderers e o executor existente. Não crie um segundo servidor ou uma
timeline paralela. Um render local com assets próprios não exige login Google.
O sandbox de produção bloqueia rede, cookies e arquivos não declarados.

Use a [direção de motion](docs/DIRECAO-MOTION-ORGANICO.md) para planejar movimento
e o [fluxo audio-first](templates/audio-first-multi-capitulos/README.md) quando
a montagem precisar seguir a narração medida. Efeitos sonoros são pistas reais,
sincronizadas na timeline e mixadas pelo Studio; não surgem automaticamente por
um objeto se mover em Three.js.

## Contas próprias

Cada pessoa deve ativar suas contas no próprio usuário Windows. O setup abre
Chrome comum para login manual; depois, a captura alimenta o Credential Manager.
O perfil renovável e os cookies ficam fora do projeto.

```powershell
npm run session -- setup --provider google
npm run session -- setup --provider flow-music
npm run session -- status
npm run session -- refresh --provider google
npm run session -- refresh --provider flow-music
```

Omni usa a sessão Google; narração externa usa Google Vids e trilha usa Flow
Music. O projeto é cookie-only: não configure chave Gemini nem auth api. Não
copie cookies, perfis, HARs ou bancos de outra instalação. Os domínios de cada
serviço são filtrados para seu cofre. Login válido não garante geração remota.

## Criar e retomar

O modo raw mantém o prompt literal e o MP4 original. Studio adiciona as etapas
explicitamente solicitadas: direção, voz, música, animação, montagem, legenda,
acabamento e QA. Uma imagem não substitui locução, e validar JSON não comprova
que o master físico contém a fala, a trilha ou a sincronia prevista.

Para uma geração direta, escreva a direção em um arquivo UTF-8 seu:

```powershell
npm run video -- generate --mode raw --prompt-file cena.txt --collection minha-peca
```

Referências externas exigem `--confirm-provider-input true` na invocação.
Consulte a ajuda para escolher `--image`, `--first-frame` ou `--video`: referência
de conteúdo, quadro inicial e vídeo para edição têm papéis diferentes. Não use
uma foto de pessoa numa cena em que ela não deve aparecer. Geração intermediária
de imagem é uma etapa explícita; `npm run image -- --help` mostra suas opções.

Os [modelos de receitas](recipes/LEIA-ME.md) e os
[exemplos de Receita Mestre](recipes/EXEMPLOS-TECNICOS.md) preservam estruturas
reutilizáveis. Preencha seus textos, assets, documento Vids e autorizações antes
de produzir. Não execute placeholders como se fossem um roteiro pronto.

Para um filme compatível com o contrato de spec, o fluxo é:

```powershell
npm run video -- dry-run --spec filme.json
npm run video -- plan --spec filme.json
```

Use o caminho de estado retornado pelo planner em `run --state`; guarde-o para
`status`, `reconcile` e `resume`. O executor reutiliza nós concluídos e respeita
o plano e a autorização registrados. Uma chamada ambígua exige reconciliação,
não uma segunda submissão cega. O fluxo production-once segue até a entrega;
aprovação de draft permanece para workflows que declarem pausa editorial.
O [rollout do executor](docs/guias/EXECUTOR-ROLLOUT.md) explica compatibilidade
com estados antigos. Consulte `batch --help` para jobs independentes.

## Voz, trilha, acabamento e entrega

Use `tts --help`, `music --help`, `align --help` e `mix --help` para as operações
de áudio no CLI. Narração Google Vids e trilha Flow Music são materiais reais;
Whisper local mede as palavras. O [visualizador de áudio](docs/AUDIO-WAVE-STUDIO.md)
permite ouvir as pistas e exportar pelo mixer no Windows.

O acabamento entra pelo Studio: consulte `finish`, `captions` e `qa`. Preservar
originais, verificar duração e streams, conferir a narração e ouvir o arremate
fazem parte da entrega. Não aplique fade-out sem pedido explícito. QA semântico
depende de adapter verificado; o QA técnico local não substitui essa capacidade.

Sem um destino explícito, as coleções ficam em outputs: videos-soltos contém
originais, videos-unidos contém masters, receitas guarda recibos e metadados
mantém estado e informações da montagem. Não versionar produções ou recibos.
O [guia do app](docs/GERADOR-APP.md) explica o acervo; index, search e review têm
ajuda própria. Para publicação opcional, siga a
[entrega no Drive](docs/guias/ENTREGA-DIARIA-DRIVE.md), com sua conta e destino.

## Conhecimento e evolução

Conhecimento técnico global versionado fica em knowledge. Dados privados,
clientes, marcas e pessoas pertencem ao Knowledge Core governado, fora do Git.
Consulte `knowledge --help` para inicialização, integridade, backup, restore,
releases e decisões humanas. Backup não é uma cópia de banco aberto; restauração
exige destino novo e validação de integridade. Não misture raízes de clientes.

A [arquitetura](docs/ARCHITECTURE-BOUNDARIES.md), os [ADRs](docs/adr/) e a
[documentação de plugins Wasm](plugins/README.md) orientam extensões. Este pacote
não contém o acervo privado do autor nem acervo de terceiros.

## Verificar mudanças

```powershell
npm run docs:check
npm run recipes:check
npm test
```

Esses comandos verificam os documentos gerados, receitas e testes da árvore
instalada. Os testes usam dublês e mídia sintética; alguns requerem Chrome e
FFmpeg e outros têm requisitos opcionais ou exclusivos do Windows. Leia falhas
e skips. O [runbook de distribuição](docs/DISTRIBUICAO-RUNBOOK.md) explica o CI,
atualização e as verificações em uma máquina nova. npm run check é o verificador
ampliado do CORE e exige contexto Git; não é um build de app Tauri.

O [índice de documentação](docs/LEIA-ME.md) reúne os demais guias. Documentos
históricos descrevem decisões anteriores, sem comprovar a configuração atual.
