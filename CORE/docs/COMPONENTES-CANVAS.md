# Componentes Canvas para composições do Studio

`lib/media-pipeline/canvas-motion-primitives.mjs` reúne primitivas extraídas das
composições existentes: clamp, smooth, out, spring, bounce, card, circle, line,
text, shadow e glow. Recebe um contexto Canvas 2D e não abre mídia, rede,
filesystem, relógio ou loop de animação. A timeline existente continua fornecendo
o frame; texto é opcional e deve vir do projeto do usuário.

`examples/canvas-motion-components.mjs` oferece
`canvasMotionComponentsDocument({ width, height, accent, background })`.
Ele devolve HTML autossuficiente, com quatro cartões que entram em sequência e
convergem ao centro. Não escreve arquivos nem renderiza por conta própria.
As cores usam #RRGGBB; largura e altura aceitam inteiros entre 64 e 4096.

O HTML implementa `window.__setFrame(frame, total)` para consumo pelo renderer
Studio existente. Para desenvolvimento, materialize o documento em um arquivo
local declarado e use a entrada `documentFile` de `renderHtmlMotionPilot`, com
engine playwright. Integração em produções canônicas continua sujeita ao fluxo
de documento/asset autorizado do Studio. O comando render de cenas paramétricas
não recebe esse exemplo automaticamente; ele não é um novo preset de interface.

A biblioteca mantém o estado Canvas normal entre operações. Use save/restore
para compor transformações; shadow já restaura seu estado mesmo se o desenho
falhar. A curva spring preserva a oscilação amortecida e não impõe valor 1 exato
no fim. Para travar um elemento no destino, trate o último frame na composição.

O exemplo neutro demonstra os componentes, não representa reconstrução completa
dos templates autorais. A separação dos demais componentes, roteiros e assets
desses templates permanece parte da preparação da distribuição.
