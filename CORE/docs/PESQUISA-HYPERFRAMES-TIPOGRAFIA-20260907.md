# HyperFrames: pesquisa de tipografia e 20 receitas para o Studio

Pesquisa realizada em **7 de setembro de 2026**, com consulta a um cliente Grok local, documentação oficial, código aberto e verificação de posts com **Playwright headless**. Nenhum vídeo, voz ou trilha foi gerado nesta etapa.

## O que estava deixando o texto rígido

O problema estava no template local. `organic-launch.mjs` usa Arial e revelações de linha; o piloto também restringe a família de fonte. Isso não representa o limite do HyperFrames. No repositório oficial há componentes de troca de palavras, camadas tipográficas, peso, máscaras, preenchimento, câmera e lettering. A composição precisa escolher esses recursos de acordo com a mensagem. [Guia oficial de prompts](https://hyperframes.app/docs/3-guides/2-prompting), [tipografia oficial](https://github.com/heygen-com/hyperframes/blob/0d5d3f3eb3aecd9fd64954d2767d3d64e97e58fc/skills/hyperframes-creative/references/typography.md).

Três coisas precisam ser decididas separadamente: o desenho da letra; o mecanismo que a move; a razão pela qual esse movimento leva à próxima ideia. Pedir apenas “premium, orgânico, morph” deixa essas decisões abertas e favorece uma animação genérica. As vinte receitas especificam as três.

## O que a pesquisa no X encontrou

O cliente local consultou o Grok em modo Especialista (`grok-4`), com buscas por palavras-chave, semântica e leitura de threads. A resposta trouxe doze indicações, mas continha alguns IDs truncados e afirmações que precisavam de conferência. Usei a resposta como pista de pesquisa. Os cinco links abaixo foram abertos e seus conteúdos observados com Playwright headless autenticado; os demais não foram tratados como fontes confirmadas.

| Fonte verificada | O que o post realmente oferece | Uso nesta pesquisa |
|---|---|---|
| [HeyGen: lançamento oficial](https://x.com/HeyGen/status/2044827454460871072) | Declara que o lançamento foi feito com HyperFrames e divulga o framework; não contém o prompt completo. | Localizar uma produção oficial e distinguir demo de receita. |
| [Bin Liu: processo e código](https://x.com/liu8in/status/2080234478170157085) | Mostra um processo de recriação, aponta o framework e menciona código no fio. | Chegar ao [projeto K3 com HTML e MP4](https://github.com/heygen-com/hyperframes-launches/tree/main/k3-promo); não copiar afirmações de desempenho de modelos. |
| [Ray Velez: máscaras CSS](https://x.com/pascowebdesigns/status/2076475853542961214) | O autor credita máscaras CSS como inspiração para sua peça em HyperFrames. | Fundamentar a pesquisa de revelações; não atribuir ao autor um prompt que ele não publicou. |
| [Shinemon: tipografia por glifo](https://x.com/shinemon_33/status/2091580402087661885) | Relata uso de scatter/slam por glifo em japonês. | Verificar que recursos tipográficos existem e lembrar de preservar shaping e acentos. |
| [HyperFrames: Day 20](https://x.com/HyperFrames_/status/2081184676430160379) | Artigo sobre design e animação, incluindo um fundo que precisa continuar entre cenas. | Reforçar continuidade de camada; o fundo não reinicia em cada mudança de texto. |

**Não encontrei vinte prompts completos de tipografia avançada publicados no X.** O Grok também não apresentou esse conjunto. Foram encontrados exemplos, orientações e código. As vinte receitas entregues são autorais e identificadas como tal.

O registro local preserva consulta, resposta e leitura dos posts em `diagnosticos/hyperframes-tipografia-20260907/`. O campo de hora coletado em um post com citação pode se referir ao tweet citado; esta síntese usa o link exato e não depende dessa data. Nenhum comentário, repost ou mensagem a autores foi enviado.

## Prompts públicos e código consultados

Na revisão `46700f6e8b97c873e953392231bcf62b525c8dd3` do Open Design havia **18 prompts de HyperFrames**, incluindo promo de produto, sizzle, janela/portal, cursor e fundo líquido. Isso atualiza o número de onze citado em versões antigas do README. São briefs públicos úteis para estudar especificidade, não uma garantia de qualidade visual. [Pasta de prompts](https://github.com/nexu-io/open-design/tree/46700f6e8b97c873e953392231bcf62b525c8dd3/prompt-templates/video), [exemplo de promo SaaS](https://github.com/nexu-io/open-design/blob/46700f6e8b97c873e953392231bcf62b525c8dd3/prompt-templates/video/hyperframes-saas-product-promo-30s.json).

Os storyboards oficiais descrevem finalidade, ordem, câmera, texto e som por passagem. Essa estrutura é mais útil do que acumular adjetivos. Nossas receitas usam cópia e coreografia próprias para o Gerador. [Storyboard do lançamento](https://github.com/heygen-com/hyperframes-launch-video/blob/main/STORYBOARD.md), [website para vídeo](https://github.com/heygen-com/website-to-hyperframes-demo/blob/main/STORYBOARD.md).

| Mecanismo estudado | Decisão aplicada às receitas |
|---|---|
| [Kinetic Type Swap](https://github.com/heygen-com/hyperframes/blob/0d5d3f3eb3aecd9fd64954d2767d3d64e97e58fc/registry/components/kinetic-type-swap/kinetic-type-swap.html) | Reservar a largura da maior palavra e mover somente o conteúdo do slot; remover a pulsação de repouso na adaptação. |
| [Weight Shift](https://github.com/heygen-com/hyperframes/blob/0d5d3f3eb3aecd9fd64954d2767d3d64e97e58fc/registry/components/caption-weight-shift/caption-weight-shift.html) | O exemplo anima fontWeight. Para transição tipográfica contínua, fornecer uma fonte variável real e medir seu layout. |
| [Morph Text](https://github.com/heygen-com/hyperframes/blob/0d5d3f3eb3aecd9fd64954d2767d3d64e97e58fc/registry/components/morph-text/morph-text.html) | Usa duas camadas, blur e threshold. Esse nome não significa correspondência de contornos. Não foi adotado como solução para os morphs rejeitados. |
| [Stitched Text Draw](https://github.com/heygen-com/hyperframes/blob/0d5d3f3eb3aecd9fd64954d2767d3d64e97e58fc/registry/components/stitched-text-draw/README.md) | Distinguir caminho de escrita e perímetro; o exemplo só cobre A–Z, números e espaço, portanto português exige lettering próprio. |
| [Mecanismos de keyframe](https://github.com/heygen-com/hyperframes/blob/0d5d3f3eb3aecd9fd64954d2767d3d64e97e58fc/skills/hyperframes-keyframes/references/keyframe-patterns.md) | Escolher um mecanismo principal e verificar o resultado em tempos arbitrários. |
| [Linguagem de movimento](https://github.com/heygen-com/hyperframes/blob/0d5d3f3eb3aecd9fd64954d2767d3d64e97e58fc/skills/product-launch-video/references/motion-language.md) | Separar viagem, assentamento e passagem contínua; overshoot não é padrão. |
| [Eixos variáveis](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-variation-settings) | Animar eixos existentes no arquivo. A receita 01 usa largura/peso; a 15 usa GRAD da Roboto Flex. |
| [SVG textPath](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/textPath) | Posicionar letras por trajetória sem deformar cada glifo; leitura principal ganha trecho horizontal. |
| [GSAP Flip](https://gsap.com/docs/v3/Plugins/Flip/) e [SplitText](https://gsap.com/docs/v3/Plugins/SplitText/) | Reposicionar elementos e dividir texto com métricas reais; validar acentos, wraps e seek. |

A revisão oficial do HyperFrames consultada foi `0d5d3f3eb3aecd9fd64954d2767d3d64e97e58fc`. Os arquivos técnicos baixados têm hashes. A implementação oficial não substitui o contrato da casa: exemplos com CDN, outros provedores de voz ou relógios incompatíveis precisam de adaptação.

## Como essa inteligência entrou no CLI

Na pasta `CORE`, usar:

```powershell
node scripts/omni-cli.mjs receitas --action direcoes
node scripts/omni-cli.mjs receitas --action direcoes --id 08-fita-de-ideias --format prompt
node scripts/omni-cli.mjs receitas --action direcoes --id 01-eixo-vivo --format json
```

A consulta é local e não chama provedores. A seleção entrega a direção estruturada, prompt completo, roteiro, prompt de trilha, regras de Whisper, fontes bibliográficas e assets com hashes conferidos. O modo JSON informa `readiness.authoring=true`, `readiness.render=false` e `executablePreset=false` na lista. Arquivo alterado, fonte sem licença ou hash divergente interrompe a seleção.

O CLI usa a pasta existente de receitas como origem. Não foi criado outro servidor, planner, executor ou banco privado. A consulta não promove conhecimento e não altera o modo raw.

**Limite atual:** as vinte composições ainda precisam ser implementadas no adapter para renderizar. Os prompts orientam essa implementação, incluindo a extensão explícita do binding de fontes; não mandam desligar a proteção de Arial ou contornar o renderer. Esta entrega não afirma que vinte novos presets foram renderizados e aprovados.

## Entrega

As vinte direções autorais descritas acima ficam com o autor da pesquisa; o que
viaja aqui é o método: as fontes verificadas, os mecanismos estudados e a decisão
aplicada a cada um. As oito famílias de fontes com licença e manifesto estão em
[assets/fonts/hyperframes-tipografia/manifest.json](../assets/fonts/hyperframes-tipografia/manifest.json).
