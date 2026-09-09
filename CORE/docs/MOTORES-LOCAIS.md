# Motores locais de vídeo

O comando `render` usa o pipeline Studio existente para capturar quadros,
montar MP4 com FFmpeg, verificar frames e registrar recibos. Não exige sessão
Google para renderização local. Narração, música e mixagem são etapas explícitas.

| Motor | Uso | Dependência fixada |
| --- | --- | --- |
| Three.js | Cenas 3D, galeria, prismas, órbitas e autoria | Consulte [Three Design Studio](THREE-DESIGN-STUDIO.md) |
| HyperFrames | Composições locais HTML/Canvas/SVG | @hyperframes/engine 0.8.30 |
| Remotion | Composição React interna | @remotion/renderer e bundler 4.0.521 |
| Playwright | Captura padrão do documento local | Chrome instalado e identificado por hash |

As dependências npm estão no package-lock.json. Execute INSTALAR.ps1 na raiz
para prepará-las e configurar o Chrome. Não use chromium.executablePath() como
garantia de navegador instalado: esta distribuição usa Chrome local e não baixa
um navegador implicitamente. CHROME_PATH permite informar outro executável.

## Primeiro render

Em CORE, com os requisitos instalados:

```powershell
npm run video -- render --action engines
npm run video -- render --action render --mode studio --engine hyperframes --spec examples/local-render-scene.json --collection meu-motion --dry-run true
npm run video -- render --action render --mode studio --engine hyperframes --spec examples/local-render-scene.json --collection meu-motion --dry-run false
```

Troque hyperframes por remotion para a composição React. Os desenhos internos
dos dois motores são diferentes. O dry-run não captura nem grava; sem --out,
o resultado usa outputs/<collection>/videos-unidos, receitas e metadados.
--out, quando informado, exige MP4. Um renderer não é substituído silenciosamente.

O exemplo básico permite título, subtítulo, CTA, resolução, fps, duração,
proporção e cores. Os limites dependem do template; valide pelo dry-run.
Texto é tratado como texto, nunca como código. O preset básico usa Arial local;
fontes de outros templates dependem das respectivas licenças e bindings.

## Templates neutros da distribuição

- [Explainer de seis cenas](EXPLAINER-SEIS-CENAS.md): cards, setas, relógios,
  convergência, estados e palavras sincronizadas; exemplo de 12 segundos.
- [Scanner](SCANNER-MOTION.md): câmera, parallax, varredura luminosa, miras,
  telemetria ilustrativa e imagem própria incorporada.
- [Quadrantes](QUADRANTES-MOTION.md): chat, notificações, personagem, player,
  transformação de formas e encerramento; composição quadrada de 14,5 segundos.
- [Componentes Canvas](COMPONENTES-CANVAS.md): primitivas e autoria de um
  documento no renderer existente.

Os identificadores técnicos antigos dos templates permanecem por compatibilidade.
As variantes públicas usam conteúdo neutro; fotos, logos, narrações e masters
da instalação de origem não acompanham o pacote.

## Motion tipográfico e controles avançados

O motor também contém os templates kinetic-launch@1, integrated-launch@1,
organic-launch@1, premium-morph@1 e typographic-play@1. Alguns validam âncoras
semânticas específicas: não aceitam qualquer roteiro apenas pela troca do título.
A disponibilidade do código não torna uma receita pessoal reutilizável; revise
as âncoras e forneça palavras medidas da própria locução antes de executar.
Não transporte JSON de alinhamento, roteiro ou recibos da instalação de origem.

--words recebe o alinhamento existente; não recalcula seus tempos. Em
integrated-launch@1, motionControls permite travelBezier, settleBezier,
overlapSeconds, depth e trailSamples. A Bézier é invertida em x para controlar
tempo; depth controla camadas e trailSamples o rastro, sem blur global.
Curvas inválidas e opções desconhecidas falham antes da captura.

organic-launch@1 usa objetos persistentes, máscaras e material procedural com
GSAP incorporado localmente. Travel e arrival são canais separados, sem relógio
paralelo. Seu contrato exige arremate após a última palavra; não é um preset
livre para qualquer roteiro sem adaptação de autoria.

premium-morph@1 oferece materia, impacto, traco, fita e prisma. Os keyframes
declaram palavra, texto, duração, curva, posição, escala, rotação, stretch e
bend. OpenType transforma fontes locais autorizadas em contornos. O método
associa contornos por índice; não promete continuidade semântica entre objetos.
Não há editor gráfico de curvas: os parâmetros são dados do spec congelado.

typographic-play@1 possui dez composições no código, com duração de 14 segundos,
16:9 e fonte HyperframesTypography. A copy e a paleta pertencem à playRecipe;
title/subtitle/cta identificam a peça no recibo. Essa rota não recebe --words,
documentos externos, Remotion ou áudio implícito. Fontes OFL autorizadas são
incorporadas e hasheadas. A seleção dos exemplos de autoria segue a revisão do
pacote, sem transportar produções pessoais.

captureFormat jpeg é opt-in no HyperFrames e usa qualidade 100; é compressão
com perdas anterior ao H.264. O padrão permanece PNG. Formato e qualidade entram
no recibo. Não há alteração silenciosa de resolução, fps ou áudio.

## Documentos próprios e recuperação

Para autoria de HTML/Canvas, siga [HTML na receita](HTML-NA-RECEITA.md). O contrato
de documento autorizado e o sandbox continuam obrigatórios. Opções avançadas dos
builders não viram campos do editor automaticamente. Estenda a espinha existente;
não crie outro compilador, executor ou servidor de aplicação.

--recover-existing true reconcilia somente a mesma saída, parâmetros, ferramentas
e hashes. Pode completar uma publicação parcial íntegra; não atribui receita nova
a arquivo antigo nem sobrescreve originais. Mudança de browser, fonte, código ou
motor exige outra saída. Guarde os recibos junto dos masters.

## Isolamento e limites

Capturas usam navegadores descartáveis sem sessão, rede bloqueada e arquivos
declarados. O Remotion utiliza o servidor efêmero do próprio renderer para seu
bundle, encerrado com a captura; não é um app adicional. HyperFrames mantém a
página virtual em memória. A captura Windows usa screenshots.

O ambiente registra versões e hashes de Node, Chrome, FFmpeg, fontes e código.
Não se promete determinismo entre instalações diferentes. Limite de parede e
heap JavaScript não representam limite rígido de memória total do processo.
O master visual é silencioso: use mix/mux-audio no Studio para áudio real,
com encerramento sem fade automático e QA físico após a montagem.

HyperFrames declara Apache-2.0; Remotion tem licença própria, disponível em
node_modules/remotion/LICENSE.md. Consulte os termos aplicáveis ao seu uso.
Esta documentação descreve capacidades e limites; provas da cópia revisada
estão separadas dos resultados e produções do autor original.
