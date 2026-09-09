# Catálogo de estilos

<!-- Gerado por scripts/generate-style-catalog.mjs. Não editar manualmente. -->

Schema fonte: `mkt-videos/style-spec@1`.

Este índice provider-free deriva exclusivamente do registro canônico em
`lib/media-pipeline/direction-presets.mjs`. Um estilo `concept` pode ser
inspecionado, mas não é selecionável para geração live por padrão.

Total: 13 estilos; 11 disponíveis para geração live; 0 validados por evidência.

| ID | Nome | Família | Lifecycle | Disponível | Evidência | Aspecto sugerido | Tags |
|---|---|---|---|---|---|---|---|
| `aquarela-2d@1` | Aquarela 2D | `illustration` | `pilot` | sim | `not-evidence-validated` | herdado | `2d`, `watercolor`, `organic` |
| `cinematic-3d@1` | Cinematic 3D | `cinematic` | `pilot` | sim | `not-evidence-validated` | herdado | `3d`, `cinematic`, `premium` |
| `documentario-sobrio@1` | Documentário sóbrio | `documentary` | `pilot` | sim | `not-evidence-validated` | `16:9` | `documentary`, `native-typography`, `documentario-sobrio` |
| `documentario@1` | Documentário | `documentary` | `pilot` | sim | `not-evidence-validated` | herdado | `documentary`, `broadcast`, `natural` |
| `duelo-de-ditados@1` | Duelo de Ditados | `narrative-typography` | `concept` | não | `not-evidence-validated` | `16:9` | `proverb-duel`, `kinetic-typography`, `comic-counterpoint`, `expressive-cuts` |
| `flat-2d@1` | Flat 2D | `motion-graphics` | `pilot` | sim | `not-evidence-validated` | herdado | `2d`, `flat`, `motion-graphics` |
| `logo-fiel@1` | Logo fiel | `brand` | `pilot` | sim | `not-evidence-validated` | herdado | `logo`, `brand`, `fidelity` |
| `plantao@1` | Plantão | `documentary` | `pilot` | sim | `not-evidence-validated` | `16:9` | `documentary`, `native-typography`, `plantao` |
| `produto/streaks-de-luz@1` | Streaks de luz | `produto` | `concept` | não | `not-evidence-validated` | herdado | `abstract`, `light-streaks`, `product-motion` |
| `react-audiovisual@1` | React audiovisual | `motion-graphics` | `pilot` | sim | `not-evidence-validated` | herdado | `react`, `jsx`, `css`, `motion-graphics`, `narration`, `sound-design` |
| `soft-realism@1` | Soft realism | `editorial` | `pilot` | sim | `not-evidence-validated` | herdado | `soft-realism`, `people`, `editorial` |
| `suspensao@1` | Suspensão | `documentary` | `pilot` | sim | `not-evidence-validated` | `16:9` | `documentary`, `native-typography`, `suspensao` |
| `vertical-social@1` | Vertical social | `social` | `pilot` | sim | `not-evidence-validated` | `9:16` | `vertical`, `social`, `mobile` |

## `aquarela-2d@1` — Aquarela 2D

- Família: `illustration`.
- Status: `pilot`.
- Somente Studio: sim.
- Selecionável para geração live: sim.
- Aspecto sugerido: herdado do pedido.
- Tags: `2d`, `watercolor`, `organic`.

### Direção

Expressive 2D watercolor animation on textured paper, translucent pigment layers, visible soft brush edges, elegant negative space, organic shape transitions, gentle parallax, restrained linework, and handcrafted frame-to-frame motion.

### Componentes opcionais de direção

Seleção explícita em `recipe suggest --composition-file`. São instruções sem comprovação audiovisual da combinação; não ativam módulos de áudio nem renderers.

| Dimensão | Opções compatíveis |
|---|---|
| `material` | `paper-cut@1`, `watercolor-grain@1` |
| `typography` | `none@1`, `kinetic-words@1` |
| `composition` | `single-focus@1`, `swiss-grid@1`, `split-comparison@1` |
| `camera` | `locked@1`, `orthographic@1` |
| `movement` | `shape-morph@1`, `sequential-reveal@1` |
| `rhythm` | `measured@1`, `alternating@1`, `stepwise@1` |
| `audio` | `silent-clip@1`, `graphic-sfx@1`, `organic-sfx@1` |


### Reconciliação de evidência

- Disponibilidade: `available`.
- Estado da evidência: `not-evidence-validated`.
- Evidência de referência: `not-declared`; 0 de 0 qualificadas.
- Recibos canônicos: nenhum.
- Veredito humano: não registrado.
- Limitações registradas: nenhuma.
- Campos ausentes: `validation-model`, `validation-checked-at`, `validation-receipts`, `validation-aspects`, `human-verdict`, `validation-test-notes`, `limitations`.
- Bloqueios: nenhum.

## `cinematic-3d@1` — Cinematic 3D

- Família: `cinematic`.
- Status: `pilot`.
- Somente Studio: sim.
- Selecionável para geração live: sim.
- Aspecto sugerido: herdado do pedido.
- Tags: `3d`, `cinematic`, `premium`.

### Direção

Premium cinematic 3D animation with physically plausible materials, controlled depth of field, deliberate composition, soft global illumination, restrained natural movement, stable geometry, coherent hands and faces, and clean cinematic camera work.

### Componentes opcionais de direção

Seleção explícita em `recipe suggest --composition-file`. São instruções sem comprovação audiovisual da combinação; não ativam módulos de áudio nem renderers.

| Dimensão | Opções compatíveis |
|---|---|
| `material` | `natural-texture@1` |
| `typography` | `none@1` |
| `composition` | `single-focus@1`, `split-comparison@1` |
| `camera` | `locked@1`, `slow-push@1` |
| `movement` | `sequential-reveal@1`, `match-action@1` |
| `rhythm` | `measured@1`, `alternating@1`, `stepwise@1` |
| `audio` | `silent-clip@1`, `graphic-sfx@1`, `organic-sfx@1` |


### Reconciliação de evidência

- Disponibilidade: `available`.
- Estado da evidência: `not-evidence-validated`.
- Evidência de referência: `not-declared`; 0 de 0 qualificadas.
- Recibos canônicos: nenhum.
- Veredito humano: não registrado.
- Limitações registradas: nenhuma.
- Campos ausentes: `validation-model`, `validation-checked-at`, `validation-receipts`, `validation-aspects`, `human-verdict`, `validation-test-notes`, `limitations`.
- Bloqueios: nenhum.

## `documentario-sobrio@1` — Documentário sóbrio

- Família: `documentary`.
- Status: `pilot`.
- Somente Studio: sim.
- Selecionável para geração live: sim.
- Aspecto sugerido: `16:9`.
- Tags: `documentary`, `native-typography`, `documentario-sobrio`.

### Direção

For interview scenes only: WHERE: an ordinary classroom after everyone has gone. Rows of empty chairs and desks behind him, far enough back to be soft and unreadable. Late afternoon daylight comes from a tall window on one side and falls across his face; the rest of the room sinks into quiet shadow. Muted colours, real dust in the air, nothing decorative, no posters or writing anywhere. For abstract art scenes only (no person or room): Flat 2D kinetic typography in 16:9 on a flat, evenly filled field of deep desaturated grey-green - the colour of a classroom wall with the lights switched off. Off-white heavy condensed letterforms and flat abstract marks. One single accent colour: warm amber, the colour of late afternoon light through a window, used sparingly and never as a fill for the whole frame. Generous margins, one clear idea per frame, nothing decorative.

### Componentes opcionais de direção

Seleção explícita em `recipe suggest --composition-file`. São instruções sem comprovação audiovisual da combinação; não ativam módulos de áudio nem renderers.

| Dimensão | Opções compatíveis |
|---|---|
| `material` | `natural-texture@1` |
| `typography` | `none@1`, `editorial-labels@1` |
| `composition` | `single-focus@1`, `split-comparison@1` |
| `camera` | `locked@1`, `slow-push@1`, `observational@1` |
| `movement` | `sequential-reveal@1`, `match-action@1` |
| `rhythm` | `measured@1`, `alternating@1`, `stepwise@1` |
| `audio` | `silent-clip@1`, `graphic-sfx@1`, `organic-sfx@1` |


### Validação

- Modelo: não registrado.
- Verificado em: não registrado.
- Veredito humano: não registrado.
- Aspectos: nenhum.
- Recibos: nenhum.
- Notas:
  - Blocos extraídos de produções locais; igualdade de composição verificada, eficácia não promovida.

### Riscos

- Escolher lugar para entrevista e identidadeArte para arte; o compositor da série mantém essas cenas separadas.
- Texto e sincronia são instruções nativas ao Omni; execução exata exige inspeção do artefato.
- Sobriedade serve à observação; não obriga todo tema a usar sala de aula.
### Limitações condicionais

| Condição | Capacidade afetada | Limitação | Evidência | Fallback automático |
|---|---|---|---|---|
| native-semantic-insert@1 | onScreenText | exact-timing-and-spelling-require-artifact-inspection | observed-local | não |


### Reconciliação de evidência

- Disponibilidade: `available`.
- Estado da evidência: `not-evidence-validated`.
- Evidência de referência: `not-declared`; 0 de 0 qualificadas.
- Recibos canônicos: nenhum.
- Veredito humano: não registrado.
- Limitações registradas: Escolher lugar para entrevista e identidadeArte para arte; o compositor da série mantém essas cenas separadas.; Sobriedade serve à observação; não obriga todo tema a usar sala de aula.; Texto e sincronia são instruções nativas ao Omni; execução exata exige inspeção do artefato..
- Campos ausentes: `validation-model`, `validation-checked-at`, `validation-receipts`, `validation-aspects`, `human-verdict`.
- Bloqueios: nenhum.

## `documentario@1` — Documentário

- Família: `documentary`.
- Status: `pilot`.
- Somente Studio: sim.
- Selecionável para geração live: sim.
- Aspecto sugerido: herdado do pedido.
- Tags: `documentary`, `broadcast`, `natural`.

### Direção

Documentary-broadcast visual direction with observational camera language, grounded environments, practical lighting, readable action, natural pacing, restrained transitions, and credible ambient sound design.

### Componentes opcionais de direção

Seleção explícita em `recipe suggest --composition-file`. São instruções sem comprovação audiovisual da combinação; não ativam módulos de áudio nem renderers.

| Dimensão | Opções compatíveis |
|---|---|
| `material` | `natural-texture@1` |
| `typography` | `none@1`, `editorial-labels@1` |
| `composition` | `single-focus@1`, `split-comparison@1` |
| `camera` | `locked@1`, `slow-push@1`, `observational@1` |
| `movement` | `sequential-reveal@1`, `match-action@1` |
| `rhythm` | `measured@1`, `alternating@1`, `stepwise@1` |
| `audio` | `silent-clip@1`, `graphic-sfx@1`, `organic-sfx@1` |


### Reconciliação de evidência

- Disponibilidade: `available`.
- Estado da evidência: `not-evidence-validated`.
- Evidência de referência: `not-declared`; 0 de 0 qualificadas.
- Recibos canônicos: nenhum.
- Veredito humano: não registrado.
- Limitações registradas: nenhuma.
- Campos ausentes: `validation-model`, `validation-checked-at`, `validation-receipts`, `validation-aspects`, `human-verdict`, `validation-test-notes`, `limitations`.
- Bloqueios: nenhum.

## `duelo-de-ditados@1` — Duelo de Ditados

- Família: `narrative-typography`.
- Status: `concept`.
- Somente Studio: sim.
- Selecionável para geração live: não.
- Aspecto sugerido: `16:9`.
- Tags: `proverb-duel`, `kinetic-typography`, `comic-counterpoint`, `expressive-cuts`.

### Direção

Original theatrical audiovisual language for proverb duels. Stage each saying as a compact visual argument: a centered tableau with one bold geometric action, elastic timing, and a deliberate pause before the counter-saying flips the meaning. Let the first voice enter with ceremonial certainty—measured framing, warm stage light, upright composition—then let the opposing voice cut across with mischievous lateral motion, cooler accent light, and an expressive reaction that contradicts the words. Reuse one physical motif across neighboring scenes so the collection feels continuous, but give each block its own visual gag. Keep people fictional and stylized rather than recognizable, preserve a clear center-safe area for local Portuguese kinetic typography, leave exact text and music timing to the deterministic Studio finishing stage, and include no logos, watermarks, or imitation of an existing artist or catalog preset.

### Componentes opcionais de direção

Seleção explícita em `recipe suggest --composition-file`. São instruções sem comprovação audiovisual da combinação; não ativam módulos de áudio nem renderers.

| Dimensão | Opções compatíveis |
|---|---|
| `material` | nenhum |
| `typography` | `none@1` |
| `composition` | `single-focus@1`, `split-comparison@1` |
| `camera` | `locked@1` |
| `movement` | `sequential-reveal@1` |
| `rhythm` | `measured@1`, `alternating@1`, `stepwise@1` |
| `audio` | `silent-clip@1`, `graphic-sfx@1`, `organic-sfx@1` |


### Geração

- Tarefas permitidas: `text_to_video`, `image_to_video`.
- Tarefa padrão: `text_to_video`.
- Topologias permitidas: `independent`, `chained`.
- Topologia padrão: `independent`.
- Continuidade obrigatória: sim.

### Formatos

- Aspectos permitidos: `16:9`.
- Faixa típica de clipe: 15–25 segundos.

### Capacidades

| Capacidade | Nível |
|---|---|
| logo | `unsupported` |
| onScreenText | `limited` |
| people | `supported` |
| synchronizedAudio | `limited` |

### Inputs em execução

- Papéis obrigatórios: nenhum.
- Máximo de referências: 0.

### Riscos

- Estilo novo em concept: dry-run e inspeção permitidos; geração live exige autorização específica de piloto.
- Texto exato e sincronismo musical devem ser concluídos no acabamento Studio local.
- Não usar nomes de artistas, handles ou pedidos de imitação no prompt efetivo.

### Reconciliação de evidência

- Disponibilidade: `unavailable`.
- Estado da evidência: `not-evidence-validated`.
- Evidência de referência: `not-declared`; 0 de 0 qualificadas.
- Recibos canônicos: nenhum.
- Veredito humano: não registrado.
- Limitações registradas: Estilo novo em concept: dry-run e inspeção permitidos; geração live exige autorização específica de piloto.; Não usar nomes de artistas, handles ou pedidos de imitação no prompt efetivo.; Texto exato e sincronismo musical devem ser concluídos no acabamento Studio local..
- Campos ausentes: `validation-model`, `validation-checked-at`, `validation-receipts`, `validation-aspects`, `human-verdict`, `validation-test-notes`.
- Bloqueios: nenhum.

## `flat-2d@1` — Flat 2D

- Família: `motion-graphics`.
- Status: `pilot`.
- Somente Studio: sim.
- Selecionável para geração live: sim.
- Aspecto sugerido: herdado do pedido.
- Tags: `2d`, `flat`, `motion-graphics`.

### Direção

Clean premium flat 2D motion graphics with crisp vector shapes, disciplined spacing, strong visual hierarchy, limited color palette, smooth kinetic transitions, legible typography when requested, no photorealism, and no unnecessary visual clutter.

### Componentes opcionais de direção

Seleção explícita em `recipe suggest --composition-file`. São instruções sem comprovação audiovisual da combinação; não ativam módulos de áudio nem renderers.

| Dimensão | Opções compatíveis |
|---|---|
| `material` | `solid-vector@1`, `paper-cut@1` |
| `typography` | `none@1`, `editorial-labels@1`, `kinetic-words@1` |
| `composition` | `single-focus@1`, `swiss-grid@1`, `split-comparison@1` |
| `camera` | `locked@1`, `orthographic@1` |
| `movement` | `shape-morph@1`, `sequential-reveal@1` |
| `rhythm` | `measured@1`, `alternating@1`, `stepwise@1` |
| `audio` | `silent-clip@1`, `graphic-sfx@1`, `organic-sfx@1` |


### Reconciliação de evidência

- Disponibilidade: `available`.
- Estado da evidência: `not-evidence-validated`.
- Evidência de referência: `not-declared`; 0 de 0 qualificadas.
- Recibos canônicos: nenhum.
- Veredito humano: não registrado.
- Limitações registradas: nenhuma.
- Campos ausentes: `validation-model`, `validation-checked-at`, `validation-receipts`, `validation-aspects`, `human-verdict`, `validation-test-notes`, `limitations`.
- Bloqueios: nenhum.

## `logo-fiel@1` — Logo fiel

- Família: `brand`.
- Status: `pilot`.
- Somente Studio: sim.
- Selecionável para geração live: sim.
- Aspecto sugerido: herdado do pedido.
- Tags: `logo`, `brand`, `fidelity`.

### Direção

Use the supplied logo artwork with absolute fidelity. Do not redraw, redesign, restyle, recolor, re-letter, rotate, stretch, crop, distort, add to, or remove from it. Preserve exact shapes, proportions, spacing, lettering, and colors; animate only its reveal, placement, light, or surrounding environment.

### Componentes opcionais de direção

Seleção explícita em `recipe suggest --composition-file`. São instruções sem comprovação audiovisual da combinação; não ativam módulos de áudio nem renderers.

| Dimensão | Opções compatíveis |
|---|---|
| `material` | nenhum |
| `typography` | nenhum |
| `composition` | nenhum |
| `camera` | nenhum |
| `movement` | nenhum |
| `rhythm` | nenhum |
| `audio` | nenhum |

Este estilo preserva uma direção específica e não aceita complementos genéricos.


### Capacidades

| Capacidade | Nível |
|---|---|
| logo | `supported` |

### Reconciliação de evidência

- Disponibilidade: `available`.
- Estado da evidência: `not-evidence-validated`.
- Evidência de referência: `not-declared`; 0 de 0 qualificadas.
- Recibos canônicos: nenhum.
- Veredito humano: não registrado.
- Limitações registradas: nenhuma.
- Campos ausentes: `validation-model`, `validation-checked-at`, `validation-receipts`, `validation-aspects`, `human-verdict`, `validation-test-notes`, `limitations`.
- Bloqueios: nenhum.

## `plantao@1` — Plantão

- Família: `documentary`.
- Status: `pilot`.
- Somente Studio: sim.
- Selecionável para geração live: sim.
- Aspecto sugerido: `16:9`.
- Tags: `documentary`, `native-typography`, `plantao`.

### Direção

For interview scenes only: WHERE: a dark room with no readable depth behind him - the background falls away into near-black and shows no wall, no window, no furniture and nothing anyone could recognise or read. It is not a set and not an office: it is simply unlit space. One hard light comes from the side and cuts his face into a bright half and a shadowed half; a second hard light rims the opposite edge of his head and shoulder, separating him from the dark. No haze, no smoke, no fog, no glow, no light beams in the air, no coloured gel, no lens flare. For abstract art scenes only (no person or room): Flat 2D kinetic typography in 16:9 on a flat, evenly filled field of near-black graphite. Pure white heavy condensed letterforms, narrow, set in capitals. One single accent colour: a hard signal red, used only in small areas and only on something that is moving - never as a fill for the whole frame and never behind the words. Tight margins, urgent and stripped down, nothing decorative.

### Componentes opcionais de direção

Seleção explícita em `recipe suggest --composition-file`. São instruções sem comprovação audiovisual da combinação; não ativam módulos de áudio nem renderers.

| Dimensão | Opções compatíveis |
|---|---|
| `material` | `natural-texture@1` |
| `typography` | `none@1`, `editorial-labels@1` |
| `composition` | `single-focus@1`, `split-comparison@1` |
| `camera` | `locked@1`, `slow-push@1`, `observational@1` |
| `movement` | `sequential-reveal@1`, `match-action@1` |
| `rhythm` | `measured@1`, `alternating@1`, `stepwise@1` |
| `audio` | `silent-clip@1`, `graphic-sfx@1`, `organic-sfx@1` |


### Validação

- Modelo: não registrado.
- Verificado em: não registrado.
- Veredito humano: não registrado.
- Aspectos: nenhum.
- Recibos: nenhum.
- Notas:
  - Blocos extraídos de produções locais; igualdade de composição verificada, eficácia não promovida.

### Riscos

- Escolher lugar para entrevista e identidadeArte para arte; o compositor da série mantém essas cenas separadas.
- Texto e sincronia são instruções nativas ao Omni; execução exata exige inspeção do artefato.
- Faixa vermelha observada em contexto escuro; luminosidade não foi isolada como causa. Recusa não autoriza fallback automático.
### Limitações condicionais

| Condição | Capacidade afetada | Limitação | Evidência | Fallback automático |
|---|---|---|---|---|
| native-semantic-band-insert@1 | onScreenText | provider-refusal-observed-with-confounded-context | observed-local | não |


### Reconciliação de evidência

- Disponibilidade: `available`.
- Estado da evidência: `not-evidence-validated`.
- Evidência de referência: `not-declared`; 0 de 0 qualificadas.
- Recibos canônicos: nenhum.
- Veredito humano: não registrado.
- Limitações registradas: Escolher lugar para entrevista e identidadeArte para arte; o compositor da série mantém essas cenas separadas.; Faixa vermelha observada em contexto escuro; luminosidade não foi isolada como causa. Recusa não autoriza fallback automático.; Texto e sincronia são instruções nativas ao Omni; execução exata exige inspeção do artefato..
- Campos ausentes: `validation-model`, `validation-checked-at`, `validation-receipts`, `validation-aspects`, `human-verdict`.
- Bloqueios: nenhum.

## `produto/streaks-de-luz@1` — Streaks de luz

- Família: `produto`.
- Status: `concept`.
- Somente Studio: sim.
- Selecionável para geração live: não.
- Aspecto sugerido: herdado do pedido.
- Tags: `abstract`, `light-streaks`, `product-motion`.

### Direção

Abstract premium product motion built from original luminous streaks, controlled long-exposure trails, layered depth, restrained bloom, clean negative space, and deliberate directional flow. Keep the composition non-figurative and free of text, logos, people, recognizable interfaces, or imitated signature sequences.

### Componentes opcionais de direção

Seleção explícita em `recipe suggest --composition-file`. São instruções sem comprovação audiovisual da combinação; não ativam módulos de áudio nem renderers.

| Dimensão | Opções compatíveis |
|---|---|
| `material` | nenhum |
| `typography` | `none@1` |
| `composition` | `single-focus@1`, `split-comparison@1` |
| `camera` | `locked@1` |
| `movement` | `sequential-reveal@1` |
| `rhythm` | `measured@1`, `alternating@1`, `stepwise@1` |
| `audio` | `silent-clip@1`, `graphic-sfx@1`, `organic-sfx@1` |


### Geração

- Tarefas permitidas: `image_to_video`.
- Tarefa padrão: `image_to_video`.
- Topologias permitidas: `independent`.
- Topologia padrão: `independent`.
- Continuidade obrigatória: não.

### Formatos

- Aspectos permitidos: `16:9`, `9:16`.

### Capacidades

| Capacidade | Nível |
|---|---|
| logo | `unsupported` |
| onScreenText | `unsupported` |
| people | `unsupported` |
| synchronizedAudio | `unsupported` |

### Inputs em execução

- Papéis obrigatórios: nenhum.
- Máximo de referências: 0.

### Riscos

- Concept provider-free: ainda não há promessa de reprodução pelo Omni.
- Não usar nomes de criadores, handles ou pedidos de imitação no prompt efetivo.

### Reconciliação de evidência

- Disponibilidade: `unavailable`.
- Estado da evidência: `not-evidence-validated`.
- Evidência de referência: `not-declared`; 0 de 0 qualificadas.
- Recibos canônicos: nenhum.
- Veredito humano: não registrado.
- Limitações registradas: Concept provider-free: ainda não há promessa de reprodução pelo Omni.; Não usar nomes de criadores, handles ou pedidos de imitação no prompt efetivo..
- Campos ausentes: `validation-model`, `validation-checked-at`, `validation-receipts`, `validation-aspects`, `human-verdict`, `validation-test-notes`.
- Bloqueios: nenhum.

## `react-audiovisual@1` — React audiovisual

- Família: `motion-graphics`.
- Status: `pilot`.
- Somente Studio: sim.
- Selecionável para geração live: sim.
- Aspecto sugerido: herdado do pedido.
- Tags: `react`, `jsx`, `css`, `motion-graphics`, `narration`, `sound-design`.

### Direção

Interpret the user direction as a literal modern React, JSX and CSS audiovisual specification. Preserve component hierarchy, layout intent, tokens, state changes, motion timing and event order. Favor clean contemporary interface motion, disciplined spacing, glass or flat surfaces only when declared, stable geometry and a coherent 10-second composition. When reference images are supplied, treat them only as offscreen generative guidance unless the user explicitly marks one as <FIRST_FRAME>: frame zero must already be the first authored motion state, never a flashed reference image, poster frame, preview frame or later composition, and a complete reference logo must not appear before its declared reveal. When narration or sound cues are declared in code or comments, speak only the exact requested Brazilian Portuguese line and bind restrained sound effects precisely to their named visual events; do not add music, captions, extra speech or unscripted interface elements unless explicitly requested. End on a clean stable hold with no automatic fade-out.

### Componentes opcionais de direção

Seleção explícita em `recipe suggest --composition-file`. São instruções sem comprovação audiovisual da combinação; não ativam módulos de áudio nem renderers.

| Dimensão | Opções compatíveis |
|---|---|
| `material` | nenhum |
| `typography` | nenhum |
| `composition` | nenhum |
| `camera` | nenhum |
| `movement` | nenhum |
| `rhythm` | nenhum |
| `audio` | nenhum |

Este estilo preserva uma direção específica e não aceita complementos genéricos.


### Formatos

- Aspectos permitidos: `16:9`, `9:16`.

### Reconciliação de evidência

- Disponibilidade: `available`.
- Estado da evidência: `not-evidence-validated`.
- Evidência de referência: `not-declared`; 0 de 0 qualificadas.
- Recibos canônicos: nenhum.
- Veredito humano: não registrado.
- Limitações registradas: nenhuma.
- Campos ausentes: `validation-model`, `validation-checked-at`, `validation-receipts`, `validation-aspects`, `human-verdict`, `validation-test-notes`, `limitations`.
- Bloqueios: nenhum.

## `soft-realism@1` — Soft realism

- Família: `editorial`.
- Status: `pilot`.
- Somente Studio: sim.
- Selecionável para geração live: sim.
- Aspecto sugerido: herdado do pedido.
- Tags: `soft-realism`, `people`, `editorial`.

### Direção

Soft-realism animated video with believable proportions, natural textures, gentle cinematic lighting, subtle facial and body movement, restrained camera motion, and a polished editorial finish without claiming photorealistic identity reproduction.

### Componentes opcionais de direção

Seleção explícita em `recipe suggest --composition-file`. São instruções sem comprovação audiovisual da combinação; não ativam módulos de áudio nem renderers.

| Dimensão | Opções compatíveis |
|---|---|
| `material` | `natural-texture@1` |
| `typography` | `none@1`, `editorial-labels@1` |
| `composition` | `single-focus@1`, `swiss-grid@1`, `split-comparison@1` |
| `camera` | `locked@1`, `slow-push@1` |
| `movement` | `sequential-reveal@1`, `match-action@1` |
| `rhythm` | `measured@1`, `alternating@1`, `stepwise@1` |
| `audio` | `silent-clip@1`, `graphic-sfx@1`, `organic-sfx@1` |


### Reconciliação de evidência

- Disponibilidade: `available`.
- Estado da evidência: `not-evidence-validated`.
- Evidência de referência: `not-declared`; 0 de 0 qualificadas.
- Recibos canônicos: nenhum.
- Veredito humano: não registrado.
- Limitações registradas: nenhuma.
- Campos ausentes: `validation-model`, `validation-checked-at`, `validation-receipts`, `validation-aspects`, `human-verdict`, `validation-test-notes`, `limitations`.
- Bloqueios: nenhum.

## `suspensao@1` — Suspensão

- Família: `documentary`.
- Status: `pilot`.
- Somente Studio: sim.
- Selecionável para geração live: sim.
- Aspecto sugerido: `16:9`.
- Tags: `documentary`, `native-typography`, `suspensao`.

### Direção

For interview scenes only: WHERE: an ordinary, unremarkable interior, lit by one strong directional source from a single side - a window, a doorway, a lamp out of frame - so that one half of him is lit and the other falls away into shadow. Cool, desaturated colour throughout, with warmth only where that light actually lands. Deep quiet, nothing moving in the room, no other person, nothing decorative and nothing legible anywhere. For abstract art scenes only (no person or room): Flat 2D kinetic typography in 16:9 on a flat, evenly filled field of deep slate blue - cold, still and airless. Off-white heavy condensed letterforms and flat abstract marks. One single accent colour: warm amber, the colour of the one light source in the room, used sparingly and never as a fill for the whole frame. Wide margins, a lot of empty field around everything, one clear idea per frame, nothing decorative.

### Componentes opcionais de direção

Seleção explícita em `recipe suggest --composition-file`. São instruções sem comprovação audiovisual da combinação; não ativam módulos de áudio nem renderers.

| Dimensão | Opções compatíveis |
|---|---|
| `material` | `natural-texture@1` |
| `typography` | `none@1`, `editorial-labels@1` |
| `composition` | `single-focus@1`, `split-comparison@1` |
| `camera` | `locked@1`, `slow-push@1`, `observational@1` |
| `movement` | `sequential-reveal@1`, `match-action@1` |
| `rhythm` | `measured@1`, `alternating@1`, `stepwise@1` |
| `audio` | `silent-clip@1`, `graphic-sfx@1`, `organic-sfx@1` |


### Validação

- Modelo: não registrado.
- Verificado em: não registrado.
- Veredito humano: não registrado.
- Aspectos: nenhum.
- Recibos: nenhum.
- Notas:
  - Blocos extraídos de produções locais; igualdade de composição verificada, eficácia não promovida.

### Riscos

- Escolher lugar para entrevista e identidadeArte para arte; o compositor da série mantém essas cenas separadas.
- Texto e sincronia são instruções nativas ao Omni; execução exata exige inspeção do artefato.
- Espaço vazio e luz lateral servem à espera; não transformar tensão em lentidão obrigatória.
### Limitações condicionais

| Condição | Capacidade afetada | Limitação | Evidência | Fallback automático |
|---|---|---|---|---|
| native-semantic-insert@1 | onScreenText | exact-timing-and-spelling-require-artifact-inspection | observed-local | não |


### Reconciliação de evidência

- Disponibilidade: `available`.
- Estado da evidência: `not-evidence-validated`.
- Evidência de referência: `not-declared`; 0 de 0 qualificadas.
- Recibos canônicos: nenhum.
- Veredito humano: não registrado.
- Limitações registradas: Escolher lugar para entrevista e identidadeArte para arte; o compositor da série mantém essas cenas separadas.; Espaço vazio e luz lateral servem à espera; não transformar tensão em lentidão obrigatória.; Texto e sincronia são instruções nativas ao Omni; execução exata exige inspeção do artefato..
- Campos ausentes: `validation-model`, `validation-checked-at`, `validation-receipts`, `validation-aspects`, `human-verdict`.
- Bloqueios: nenhum.

## `vertical-social@1` — Vertical social

- Família: `social`.
- Status: `pilot`.
- Somente Studio: sim.
- Selecionável para geração live: sim.
- Aspecto sugerido: `9:16`.
- Tags: `vertical`, `social`, `mobile`.

### Direção

Mobile-first vertical social video direction with a clear central subject, safe margins for platform UI, immediate visual hook, bold readable composition, purposeful motion, fast but coherent pacing, and no essential content near the frame edges.

### Componentes opcionais de direção

Seleção explícita em `recipe suggest --composition-file`. São instruções sem comprovação audiovisual da combinação; não ativam módulos de áudio nem renderers.

| Dimensão | Opções compatíveis |
|---|---|
| `material` | `solid-vector@1` |
| `typography` | `none@1`, `editorial-labels@1`, `kinetic-words@1` |
| `composition` | `single-focus@1`, `swiss-grid@1`, `split-comparison@1` |
| `camera` | `locked@1` |
| `movement` | `sequential-reveal@1` |
| `rhythm` | `measured@1`, `alternating@1`, `stepwise@1` |
| `audio` | `silent-clip@1`, `graphic-sfx@1`, `organic-sfx@1` |


### Formatos

- Aspectos permitidos: `9:16`.

### Reconciliação de evidência

- Disponibilidade: `available`.
- Estado da evidência: `not-evidence-validated`.
- Evidência de referência: `not-declared`; 0 de 0 qualificadas.
- Recibos canônicos: nenhum.
- Veredito humano: não registrado.
- Limitações registradas: nenhuma.
- Campos ausentes: `validation-model`, `validation-checked-at`, `validation-receipts`, `validation-aspects`, `human-verdict`, `validation-test-notes`, `limitations`.
- Bloqueios: nenhum.

