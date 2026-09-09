# Three.js no Studio: recursos e produção

O recurso `threejs` do comando `render` usa o renderizador WebGL2 existente. O
mesmo pipeline continua responsável pela captura, FFmpeg, contagem de quadros,
recibos, isolamento e recuperação. A composição é silenciosa; voz, música e
efeitos sonoros entram pelas etapas de áudio do Studio. Não há novo servidor.

## Começar

Execute em `CORE/`. A instalação usa o lockfile, sem scripts de dependências:

```powershell
npm ci --ignore-scripts
npm run video -- render --action engines
npm run video -- render --action render --mode studio --engine threejs --spec recipes/three-gallery.render.json --collection galeria --dry-run true
npm run video -- render --action render --mode studio --engine threejs --spec recipes/three-gallery.render.json --collection galeria --dry-run false
```

Troque o arquivo por `recipes/three-prism.render.json` ou
`recipes/three-orbit.render.json`. Os presets são cenas geométricas prontas,
sem textos sobrepostos, fotos privadas, áudio ou downloads. `gallery` mostra
painéis geométricos: não carrega automaticamente as imagens de uma produção.

O dry-run valida parâmetros e dependências, não inicia navegador nem escreve
arquivos. Não comprova disponibilidade da GPU. A captura WebGL atual exige
Windows com Chrome/Chromium local e ANGLE/D3D11. Uma GPU diferente pode produzir
pixels diferentes; o recibo registra a implementação utilizada.

## Bibliotecas disponíveis

| Recurso | Versão fixada | Uso |
| --- | --- | --- |
| Three.js | 0.185.0 | Cena, câmera, geometria, materiais e luzes |
| Postprocessing | 6.39.4 | Bloom e efeitos posteriores à cena |
| GSAP | 3.14.2 | Animações pausadas, avaliadas por `totalTime(t, true)` |
| React Three Fiber | 9.7.0 | Componentes React com `frameloop: never` |
| Drei | 10.7.8 | Componentes, materiais, iluminação e geometria reutilizáveis |
| Theatre Core / Studio | 0.7.2 | Estado exportado e edição visual opcional |
| Three.quarks | 0.17.1 | Partículas com passos fixos e seed |

React/React DOM permanecem em 19.2.0; esbuild 0.28.2 empacota recursos locais.
O comando `render --action engines` verifica as versões efetivamente instaladas.
Não carregar todas as bibliotecas numa cena por conveniência: imports e
tree-shaking deixam no documento os recursos usados. Theatre Studio pertence
somente à autoria e não entra nos masters.

As licenças são distintas: Three/Fiber/Drei/Quarks usam MIT; Postprocessing,
Zlib; Theatre Core, Apache-2.0; Theatre Studio, AGPL-3.0-only; GSAP possui licença
própria. Os identificadores reais vêm dos pacotes e constam do catálogo. Não
descrever o conjunto inteiro como MIT. O editor Theatre opcional não foi
incorporado à interface pública do aplicativo.

## Qualidade, velocidade e recursos

| `quality` | Padrão | Captura | Uso |
| --- | --- | --- | --- |
| `preview` | 640 × 360, 15 fps | JPEG 90 | Conferir composição e movimentos |
| `balanced` | 1280 × 720, 30 fps | JPEG 90 | Produção com captura mais leve |
| `master` | 1920 × 1080, 30 fps | PNG | Preservar detalhes e acabamento |

O JSON pode ajustar `width`, `height`, `fps`, `aspect`, `durationSeconds`,
`background`, `accent`, `bloom` (0–2), `particles` (booleano), `seed`,
`timeOffsetSeconds` e `captureFormat` (`png` ou `jpeg`). Dimensões pares até
1920, proporções 16:9, 9:16 ou 1:1; duração de até 60 s por render e janela
global até 120 s. Para vertical/quadrado, forneça também as dimensões corretas.

Uma passagem WebGL por quadro, DPR 1, geometrias e materiais reaproveitados,
sem antialiasing adicional no composer. Bloom 0 desativa o composer; partículas
ficam desligadas por padrão. JPEG é permitido apenas para WebGL autônomo:
overlays sobre vídeo exigem PNG para preservar transparência. Nenhum gate de
rede, erro gráfico, integridade ou publicação foi retirado.

Faça primeiro a prévia; produza o master depois da direção definida. Para peças
longas, divida em trechos de 5–10 s com `timeOffsetSeconds` contínuo, mantenha
os mesmos parâmetros e una pelo comando `join`. O tempo de parede varia com
GPU, cena e formato: não há promessa de render em tempo real. Evite renderizar
muitos processos simultâneos. A captura existente mantém o limite de 600 s.

## Autoria reutilizável

`lib/media-pipeline/three-design.mjs` oferece `bundleThreeDocument(source)`.
Ele empacota em memória módulos locais, produz HTML autocontido e devolve um
binding com versões, hashes dos arquivos utilizados, lockfile e JavaScript.
É uma ferramenta de autoria confiável, não um avaliador de código externo.
O documento congelado é renderizado por `renderHtmlMotionPilot` com
`graphicsApi: webgl2`; preserve o binding no recibo.

Módulos de composição em `lib/media-pipeline/three-design/`:

- `presets.mjs`: `createDesignScene(spec)` → `seek(t)`, `render()`, `dispose()`.
- `gallery.mjs`: `createImageGallery(scene, images, options)` cria painéis com
  PNG/JPEG já incorporados e autorizados, preservando a proporção. Não lê arquivos.
- `particles.mjs`: `createParticles(scene, {seed})` oferece `seek(t)` e descarte.
- `react.mjs`: `createReactScene({canvas,width,height,element})`; exporta
  `RoundedBox`, `Lightformer`, `Environment`, `ContactShadows` e outros helpers.
- `theatre.mjs`: `createTheatreTrack({id,state,sheetName,objectName,properties,apply})`
  aplica o estado exportado sem reproduzir uma timeline autônoma.
- `editor.mjs`: `initializeTheatreEditor()` disponibiliza autoria opcional e
  exportação explícita do estado, com armazenamento persistente desativado.

`examples/three-gallery-authoring.mjs` demonstra uma galeria real de imagens:
recebe `{data: "data:image/png;base64,..."}` já autorizado pelo plano Studio,
incorpora as artes e retorna HTML/binding. Não contém referências pessoais ou
leitura de arquivos. O chamador congela o documento e usa o renderer existente.

No callback `window.__setFrame`, atualize `globalThis.__threeFrameTimeMs` com
`scene.timeSeconds * 1000`, avalie os objetos e renderize uma vez. O bundler
adapta as leituras de `Date.now` das dependências ao tempo fornecido. O acesso
direto a `Date.now` da composição continua bloqueado pelo sandbox.

GSAP usa timelines pausadas e ticker adormecido. Theatre recebe posição e
tick explícitos. Fiber usa avanço manual. Componentes que acumulam `delta`
(por exemplo, flutuação automática) precisam ser adaptados para tempo absoluto
antes de permitir seeks; não assumir que todo componente Drei é determinístico.
Environment deve receber mapa incorporado ou luzes locais, nunca um preset que
baixe HDRI. Quarks usa passos de 1/60 s, seed e reinício ao retroceder. Não use
callbacks para tocar áudio durante a captura: derive os cues da mesma minutagem.

## Receita: galeria premium discreta

Esta receita técnica orienta uma galeria discreta. Ajuste a direção ao conteúdo e à intenção de cada produção:

1. Selecionar as imagens autorizadas, preservando arquivos e proporções.
2. Manter as artes numa galeria espacial; cada painel aproxima, desacelera e
   permanece em destaque durante sua passagem na narração.
3. Usar fundo escuro, materiais contidos, contornos luminosos finos e reflexos
   lentos. Limitar partículas e bloom para manter as imagens como foco.
4. Não adicionar legendas, cabeçalhos, contadores, barras ou slogan. Textos
   incorporados às próprias artes permanecem.
5. Reutilizar a locução real e seus tempos Whisper; sincronizar a troca de
   destaque com a fala. A trilha cobre a montagem e reserva o arremate final.
6. Sound design com um voo suave por transição e um afastamento final. Sem
   clicks, impactos graves ou acentos de cristal. Ajuste o ganho do stem à voz e à trilha: os níveis de origem variam, portanto valide picos e inteligibilidade no master.
7. Renderizar os visuais, mixar áudio em cópia, alinhar amostras à duração dos
   quadros e muxar. Validar os streams físicos, narração, picos e fim musical.

Preserve receitas e masters de cada produção nas coleções locais. Os exemplos distribuídos não contêm assets pessoais.

## Fluxo de produção e retomada

O `render --engine threejs` gera visuais locais. Voz continua no Google Vids,
música no Flow Music e mixagem no Studio existente. Exemplo de fechamento,
substituindo caminhos por artefatos realmente produzidos:

```powershell
npm run video -- join --mode studio --manifest metadados/partes.json --out videos-unidos/visual.mp4
npm run video -- mux-audio --mode studio --video videos-unidos/visual.mp4 --audio audios-soltos/master-alinhado.wav --out videos-unidos/master.mp4
npm run video -- qa --mode studio --video videos-unidos/master.mp4
```

`partes.json` é uma lista ordenada de caminhos MP4 compatíveis. A mixagem usa
os comandos existentes `mix`/`audio-recipe` conforme o plano. O áudio deve
existir materialmente; renderizar a cena não gera voz nem SFX. Sem fade-out
automático. Para duração exata, o WAV deve cobrir `frameCount / fps`.

Reexecute os mesmos argumentos com `--recover-existing true` para recuperar
a publicação. Mudanças de parâmetros, código, pacotes, browser ou entradas
invalidam o vínculo; use outro destino para uma nova versão. Dry-run não
atesta que uma recuperação será aceita; essa validação acontece na execução.

O novo preset não foi adicionado automaticamente ao compilador da Receita
Mestre nem à interface do app. É acessível pelo CLI existente e pela API de
composição Studio. Para uma produção governada, assets e documentos exigem o
mesmo envelope, direitos e runtime guard do restante do Studio. A rota
`html-canvas@1` de overlays permanece 2D; não chamar essa rota de WebGL.

## Verificação

`test/three-design.test.mjs` cobre versões, parâmetros, dry-run sem escrita,
raw bloqueado, os três presets, partículas ao retroceder, Postprocessing,
React/Drei e Theatre no sandbox. A regressão de WebGL e HTML cobre isolamento,
recuperação, contagem de quadros e publicação física. Estes testes são locais,
sem login nem chamadas gerativas.

Fontes: [Three.js](https://threejs.org/docs/),
[Postprocessing](https://github.com/pmndrs/postprocessing),
[GSAP](https://gsap.com/docs/v3/), [Fiber](https://r3f.docs.pmnd.rs/),
[Drei](https://github.com/pmndrs/drei),
[Theatre Core](https://www.theatrejs.com/docs/latest/api/core),
[Quarks](https://github.com/Alchemist0823/three.quarks).

