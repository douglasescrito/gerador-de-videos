# Catálogo de técnicas de prompt e procedimentos

<!-- Gerado por scripts/generate-technique-catalog.mjs. Não editar manualmente. -->

Schema fonte: `mkt-videos/technique-spec@1`.

Este índice provider-free deriva exclusivamente do registro canônico em
`lib/media-pipeline/prompt-techniques.mjs`. Enquanto o catálogo de estilos
responde como a peça se parece, este responde como o prompt é montado.

Técnica é composição: só se aplica no modo `studio`, com um estilo
selecionado, e sempre por escolha humana explícita na invocação. `status:
proven` significa usada e mantida em produção real, não validada por
avaliação formal de qualidade.

Total: 14 técnicas; 13 selecionáveis para geração live; 0 recibos observados no acervo.
Procedimentos: 5. São parâmetros de operações existentes, nunca texto enviado ao provedor.

A contagem acima é a observação anotada em cada técnica, com a data em que
alguém olhou. Ela **não se atualiza sozinha** e pode estar velha. Para medir
contra os recibos de hoje: `npm run video -- tecnicas`. A medição separa dois
caminhos que o número somado esconde — a técnica **selecionada** na invocação,
que fica registrada no recibo, e o bloco **copiado** direto no prompt, que
funciona igual mas não deixa registro de qual técnica foi nem de qual versão.

| ID | Nome | Status | Posição | Ordem | Escopo | Recibos |
|---|---|---|---|---|---|---:|
|`identity-wardrobe-lock@1`|Trava de identidade e figurino|`pilot`|`before-user`|10|famílias `cinematic`, `editorial`, `documentary`, `illustration`; tasks `text_to_video`, `reference_to_video`, `image_to_video`|0|
|`pose-chart-reference@1`|Cartela de poses como referência visual|`pilot`|`before-user`|12|famílias `cinematic`, `documentary`, `editorial`, `social`; tasks `reference_to_video`|0|
|`vector-spec-layers@1`|Direção escrita como ficha de animação vetorial|`pilot`|`before-user`|14|estilos `flat-2d@1`, `aquarela-2d@1`, `react-audiovisual@1`; tasks `text_to_video`, `image_to_video`|0|
|`shot-list-in-clip@1`|Lista de planos dentro do clipe|`pilot`|`after-user`|20|famílias `cinematic`, `editorial`, `documentary`, `motion-graphics`, `illustration`, `social`; tasks `text_to_video`, `reference_to_video`, `image_to_video`|0|
|`known-gesture-count@1`|Pose nomeada por gesto conhecido|`pilot`|`after-user`|22|famílias `cinematic`, `documentary`, `editorial`, `social`; tasks `text_to_video`, `reference_to_video`, `image_to_video`|0|
|`hands-apart-framing@1`|Mãos separadas no quadro|`pilot`|`after-user`|24|famílias `cinematic`, `documentary`, `editorial`, `social`; tasks `text_to_video`, `reference_to_video`, `image_to_video`|0|
|`folded-finger-count@1`|Contagem pelo espaço negativo (dedos dobrados)|`pilot`|`after-user`|26|famílias `cinematic`, `documentary`, `editorial`, `social`; tasks `text_to_video`, `reference_to_video`, `image_to_video`|0|
|`render-check-flat@1`|Verificação de render flat (trava anti-3D)|`pilot`|`after-user`|30|estilos `flat-2d@1`, `aquarela-2d@1`, `react-audiovisual@1`; tasks `text_to_video`, `image_to_video`|0|
|`native-semantic-band-insert@1`|Insert nativo semântico em faixa|`pilot`|`after-user`|32|famílias `documentary`, `editorial`; tasks `reference_to_video`, `text_to_video`|0|
|`native-semantic-insert@1`|Insert nativo semântico|`pilot`|`after-user`|32|famílias `documentary`, `editorial`; tasks `reference_to_video`, `text_to_video`|0|
|`gaze-entry@1`|Continuidade de olhar: entrada|`pilot`|`after-user`|34|famílias `documentary`, `editorial`; tasks `reference_to_video`|0|
|`gaze-exit@1`|Continuidade de olhar: saida|`pilot`|`after-user`|35|famílias `documentary`, `editorial`; tasks `reference_to_video`|0|
|`object-boundary-contract@1`|Estado do objeto na fronteira entre clipes|`concept`|`after-user`|36|qualquer estilo; tasks `text_to_video`, `image_to_video`|0|
|`clean-final-frame@1`|Estado final estável e sem fade|`pilot`|`after-user`|40|famílias `motion-graphics`, `illustration`, `cinematic`, `editorial`, `documentary`, `social`, `produto`, `brand`; tasks `text_to_video`, `reference_to_video`, `image_to_video`|0|

## `identity-wardrobe-lock@1` — Trava de identidade e figurino

- Status: `pilot`.
- Nível de validação: `unvalidated`.
- Estudos: nenhum registrado.
- Incompatibilidades: nenhuma declarada.
- Posição no prompt: `before-user`, ordem 10.
- Escopo: famílias `cinematic`, `editorial`, `documentary`, `illustration`; tasks `text_to_video`, `reference_to_video`, `image_to_video`.

### Problema que evita

Em séries com a mesma pessoa, o figurino e a idade derivam entre clipes e o personagem deixa de ser reconhecível.

### Bloco

```text
WARDROBE — IDENTICAL IN ALL {{clip_count}} CLIPS, AND DELIBERATELY SIMPLE SO IT NEVER DRIFTS: {{wardrobe}}. That is the whole costume — no jacket, no cardigan, no jumper, no extra shirt over it, no hat, no glasses, no visible brands, no logos, no lettering on any garment.
IDENTITY — the same person in every clip: {{identity}}. Never a younger, slimmer or idealised version. The traits listed here are the most recognisable thing about the character and must be visible every time they are on screen.
```

### Variáveis

| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |
|---|---|---|---|---|---|
|`clip_count`|Quantidade de clipes da série|`number`|por série|sim|`12`|
|`wardrobe`|Figurino exato, peça por peça|`text`|por série|sim|—|
|`identity`|Traços que tornam a pessoa reconhecível|`text`|por série|sim|—|

### Evidência de uso

- Recibos observados: 0, em null.
- Veredito humano de qualidade: não registrado.
- Amostras:

### Limites conhecidos

- Sem enumerar as peças, o modelo acrescenta ou remove roupa entre clipes.
- Ação violenta sobre rosto real foi recusada pelo provedor; manter a direção fora de dano físico.

## `pose-chart-reference@1` — Cartela de poses como referência visual

- Status: `pilot`.
- Nível de validação: `unvalidated`.
- Estudos: nenhum registrado.
- Incompatibilidades: nenhuma declarada.
- Posição no prompt: `before-user`, ordem 12.
- Escopo: famílias `cinematic`, `documentary`, `editorial`, `social`; tasks `reference_to_video`.

### Problema que evita

Descrever pose de mão em palavras não segura contagem de dedos: o modelo ignora a descrição e repete o gesto que já sabe fazer.

### Bloco

```text
THE SECOND REFERENCE IMAGE IS NOT A SCENE — IT IS A POSE CHART, and it is the specification for the hardest part of this shot. It holds {{panel_count}} photographs, read left to right, top row first, then bottom row: {{panel_order}}. Copy those poses exactly, in that order, as {{pose_use}}. Same shapes, same counts, same clear separation.
Never film the chart itself — it is instruction only, never something the camera sees, never a photograph or a panel inside the scene.
```

### Variáveis

| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |
|---|---|---|---|---|---|
|`panel_count`|Quantidade de painéis da cartela|`number`|por série|sim|`6`|
|`panel_order`|O que cada painel significa, na ordem de leitura|`text`|por série|sim|`the poses for SIX, SEVEN, EIGHT, NINE, TEN and TEN again`|
|`pose_use`|Onde as poses entram na ação|`text`|por clipe|sim|`the shapes his hands make when he says "seis", "sete", "oito", "nove" and "dez"`|

### Evidência de uso

- Recibos observados: 0, em null.
- Veredito humano de qualidade: não registrado.
- Amostras:

### Limites conhecidos

- Cartela errada vira clipe errado: cada painel precisa ser conferido antes de virar referência.
- Sem a frase que proíbe filmar a cartela, o modelo pode colocar a imagem dentro da cena.
- Cartela montada a partir de recortes de clipes já pagos sai de graça e evita gerar uma nova.

## `vector-spec-layers@1` — Direção escrita como ficha de animação vetorial

- Status: `pilot`.
- Nível de validação: `unvalidated`.
- Estudos: nenhum registrado.
- Incompatibilidades: nenhuma declarada.
- Posição no prompt: `before-user`, ordem 14.
- Escopo: estilos `flat-2d@1`, `aquarela-2d@1`, `react-audiovisual@1`; tasks `text_to_video`, `image_to_video`.

### Problema que evita

Descrever a cena em prosa deixa o modelo escolher o acabamento: ele acrescenta brilho, sombra, vinheta e movimento de câmera. Listar negativas limpa o acabamento mas encolhe o conteúdo, e a trava de render sozinha chega a apagar os elementos descritos.

### Bloco

```text
Read the direction below as a vector animation spec, not as a scene description. Camera: locked off, static for the whole shot. Canvas: a flat {{background}} field. Every element is a numbered layer with a stated behaviour — what it is, what it does, and in what order it does it. All fills are flat and solid. Finish: {{finish}}.
```

### Variáveis

| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |
|---|---|---|---|---|---|
|`background`|Fundo chapado|`text`|por série|sim|`midnight navy`|
|`finish`|Acabamento declarado|`text`|por série|sim|`paper grain overlay at six percent`|

### Evidência de uso

- Recibos observados: 0, em null.
- Veredito humano de qualidade: não registrado.
- Amostras:

### Limites conhecidos

- Medida em estudo controlado de quatro condições no Omni do Google Vids, não no Omni do AI Studio; o comportamento no provedor principal ainda não foi refeito.
- Substitui a prosa, não convive com ela: metade ficha e metade descrição de cena devolve o acabamento inventado.
- Sem declarar o acabamento no slot finish, o modelo escolhe um por conta.

## `shot-list-in-clip@1` — Lista de planos dentro do clipe

- Status: `pilot`.
- Nível de validação: `unvalidated`.
- Estudos: nenhum registrado.
- Incompatibilidades: nenhuma declarada.
- Posição no prompt: `after-user`, ordem 20.
- Escopo: famílias `cinematic`, `editorial`, `documentary`, `motion-graphics`, `illustration`, `social`; tasks `text_to_video`, `reference_to_video`, `image_to_video`.

### Problema que evita

Pedir uma cena de dez segundos entrega um plano só; a peça fica parada quando o que se queria era montagem.

### Bloco

```text
{{clip_label}}. Cut hard between these {{shot_count}} shots, in this exact order, inside the ten seconds:
{{shots}}
```

### Variáveis

| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |
|---|---|---|---|---|---|
|`clip_label`|Rótulo do clipe|`text`|por clipe|sim|`CLIP 1`|
|`shot_count`|Quantidade de planos|`number`|por clipe|sim|`6`|
|`shots`|Um plano por linha|`text`|por clipe|sim|—|

### Evidência de uso

- Recibos observados: 0, em null.
- Veredito humano de qualidade: não registrado.
- Amostras:

### Limites conhecidos

- Acima de seis planos em dez segundos a leitura começa a se perder.
- Detecção automática de cena do ffmpeg não mede corte interno; a conferência é visual.

## `known-gesture-count@1` — Pose nomeada por gesto conhecido

- Status: `pilot`.
- Nível de validação: `unvalidated`.
- Estudos: nenhum registrado.
- Incompatibilidades: nenhuma declarada.
- Posição no prompt: `after-user`, ordem 22.
- Escopo: famílias `cinematic`, `documentary`, `editorial`, `social`; tasks `text_to_video`, `reference_to_video`, `image_to_video`.

### Problema que evita

Acima de cinco dedos o modelo não renderiza quantidade abstrata: abre as duas mãos, trava em dez e a mão deixa de bater com a palavra falada.

### Bloco

```text
EVERY POSE BELOW IS NAMED AS A GESTURE EVERYONE ALREADY KNOWS. Build them from these familiar shapes, never from an abstract count of extended fingers:
{{gesture_map}}
{{plain_part}}
```

### Variáveis

| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |
|---|---|---|---|---|---|
|`gesture_map`|Um gesto famoso por linha|`text`|por clipe|sim|`"seis" = flat open palm facing camera, next to a THUMBS-UP — fist closed, thumb straight up.
"sete" = flat open palm, next to a PEACE SIGN — the V of victory, index and middle up, thumb holding the other two down.
"oito" = flat open palm, next to a THREE-FINGER SALUTE — index, middle and ring up, thumb pinning the little finger.
"nove" = flat open palm, next to a FOUR-FINGER WAVE — four straight fingers up, thumb tucked flat across the palm.
"dez" = a HIGH-TEN, both palms flat and wide open toward the camera.`|
|`plain_part`|A parte fácil, contada do jeito comum|`text`|por clipe|sim|`The first five are the ordinary one-hand count: one finger, two, three, four, whole open hand.`|

### Evidência de uso

- Recibos observados: 0, em null.
- Veredito humano de qualidade: não registrado.
- Amostras:

### Limites conhecidos

- Nomear gesto em tom de aula puxa o modo tutorial e o modelo queima legenda na tela, mesmo com texto proibido.

## `hands-apart-framing@1` — Mãos separadas no quadro

- Status: `pilot`.
- Nível de validação: `unvalidated`.
- Estudos: nenhum registrado.
- Incompatibilidades: nenhuma declarada.
- Posição no prompt: `after-user`, ordem 24.
- Escopo: famílias `cinematic`, `documentary`, `editorial`, `social`; tasks `text_to_video`, `reference_to_video`, `image_to_video`.

### Problema que evita

Duas mãos próximas viram um amontoado só: o modelo funde as duas e a quantidade de dedos fica ilegível.

### Bloco

```text
THE TWO HANDS ARE KEPT FAR APART, ON PURPOSE, SO THEY CAN NEVER BE CONFUSED WITH EACH OTHER: {{left_hand_place}} {{right_hand_place}} A wide empty gap between them for the whole clip — they never touch, never overlap, never cross the middle of the frame, never appear as one clump of fingers. Because each hand sits alone in its own part of the frame, the fingers of one can never be read as fingers of the other.
```

### Variáveis

| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |
|---|---|---|---|---|---|
|`left_hand_place`|Onde fica a mão da esquerda|`text`|por clipe|sim|`the open palm lives high on the left side of the frame, up near his ear;`|
|`right_hand_place`|Onde fica a mão da direita|`text`|por clipe|sim|`the counting hand lives low on the right side, down near his chest.`|

### Evidência de uso

- Recibos observados: 0, em null.
- Veredito humano de qualidade: não registrado.
- Amostras:

### Limites conhecidos

- Exige fundo limpo: com cenário carregado as mãos deixam de recortar contra o fundo e o ganho some.

## `folded-finger-count@1` — Contagem pelo espaço negativo (dedos dobrados)

- Status: `pilot`.
- Nível de validação: `unvalidated`.
- Estudos: nenhum registrado.
- Incompatibilidades: nenhuma declarada.
- Posição no prompt: `after-user`, ordem 26.
- Escopo: famílias `cinematic`, `documentary`, `editorial`, `social`; tasks `text_to_video`, `reference_to_video`, `image_to_video`.

### Problema que evita

Pedir dedos levantados erra acima de cinco; o modelo acerta melhor quando o alvo descrito é o que está fechado na palma.

### Bloco

```text
DESCRIBE EACH POSE BY WHAT IS FOLDED, NOT BY WHAT IS RAISED. On the counting hand, count the fingers curled down into the palm:
{{folded_map}}
The folded fingers must be visibly folded — knuckles forward, fingertips pressed into the palm — so that the number of curled fingers is as easy to read as the number of raised ones.
```

### Variáveis

| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |
|---|---|---|---|---|---|
|`folded_map`|Quantos dedos estão dobrados em cada pose|`text`|por clipe|sim|`"seis": four fingers folded into the palm, one standing.
"sete": three folded, two standing.
"oito": two folded, three standing.
"nove": one folded, four standing.
"dez": nothing folded, all five open.`|

### Evidência de uso

- Recibos observados: 0, em null.
- Veredito humano de qualidade: não registrado.
- Amostras:

### Limites conhecidos

- A metade fácil continua contada por dedos levantados; misturar as duas leituras no mesmo número confunde.

## `render-check-flat@1` — Verificação de render flat (trava anti-3D)

- Status: `pilot`.
- Nível de validação: `unvalidated`.
- Estudos: nenhum registrado.
- Incompatibilidades: nenhuma declarada.
- Posição no prompt: `after-user`, ordem 30.
- Escopo: estilos `flat-2d@1`, `aquarela-2d@1`, `react-audiovisual@1`; tasks `text_to_video`, `image_to_video`.

### Problema que evita

Qualquer vocabulário de cenário físico — parede, chão, mesa, horizonte — puxa o flat 2D para 3D com sombra e perspectiva.

### Bloco

```text
RENDER CHECK for the direction above: draw it strictly as flat vector shapes sitting on the flat {{background}} field. It is a diagram in motion, never a physical object inside a room: no wall, no floor, no ground plane, no table, no horizon, no set, no studio lighting, no shading, no perspective, no thickness, no volume. Any reference to a surface, a boundary or a stop is drawn as a thin flat line, never as a built environment.
```

### Variáveis

| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |
|---|---|---|---|---|---|
|`background`|Fundo chapado|`text`|por série|sim|`graphite`|

### Evidência de uso

- Recibos observados: 0, em null.
- Veredito humano de qualidade: não registrado.
- Amostras:

### Limites conhecidos

- O bloco precisa vir por clipe: aplicado uma vez numa série, os clipes seguintes voltam a derivar.

## `native-semantic-band-insert@1` — Insert nativo semântico em faixa

- Status: `pilot`.
- Nível de validação: `unvalidated`.
- Estudos: nenhum registrado.
- Incompatibilidades: `native-semantic-insert@1`.
- Posição no prompt: `after-user`, ordem 32.
- Escopo: famílias `documentary`, `editorial`; tasks `reference_to_video`, `text_to_video`.

### Problema que evita

O texto da sonora precisa aparecer junto ao trecho literal falado, no espaço livre do quadro.

### Bloco

```text
ONE GRAPHIC INSERT IS DRAWN INSIDE THE PICTURE WHILE HE SPEAKS - it is part of the picture, drawn in the pixels of the frame, never a subtitle and never a caption bar.
In the empty {{side}} third of the frame, at chest height and well clear of his body, a flat signal-red horizontal band wipes open from its {{opposite_side}} edge in one fast, clean, mechanical move, and the words "{{highlight}}" are drawn on it in pure white heavy condensed capitals, stacked on short lines.
The band opens EXACTLY as he says those same words in his sentence - not before, not after. It holds perfectly still and fully legible for about two seconds. Then it wipes closed in the same direction it came from, taking the words with it in one clean move - they never crumble, dissolve, glitch, flicker or break apart. Before it arrives and after it is gone, there is no writing anywhere in the picture.
He sits in the {{opposite_side}} part of the frame and the band never touches him: it must never cross his face, his mouth, his eyes or his body at any moment. Flat and crisp: no shadow, no bevel, no glow, no 3D, no perspective, no motion blur.
```

### Variáveis

| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |
|---|---|---|---|---|---|
|`highlight`|Trecho literal da fala|`text`|por clipe|sim|—|
|`side`|Lado do insert|`text`|por clipe|sim|`right`|
|`opposite_side`|Lado da pessoa|`text`|por clipe|sim|`left`|

### Evidência de uso

- Recibos observados: 0, em null.
- Veredito humano de qualidade: não registrado.
- Amostras:

### Limites conhecidos

- A recusa da faixa em um contexto e sua aceitação em outro não isolam luminosidade como causa.
- O destaque deve ocorrer literalmente na fala; o quadro precisa reservar espaço para o insert.

## `native-semantic-insert@1` — Insert nativo semântico

- Status: `pilot`.
- Nível de validação: `unvalidated`.
- Estudos: nenhum registrado.
- Incompatibilidades: `native-semantic-band-insert@1`.
- Posição no prompt: `after-user`, ordem 32.
- Escopo: famílias `documentary`, `editorial`; tasks `reference_to_video`, `text_to_video`.

### Problema que evita

O texto da sonora precisa aparecer junto ao trecho literal falado, no espaço livre do quadro.

### Bloco

```text
ONE GRAPHIC INSERT IS DRAWN INSIDE THE PICTURE WHILE HE SPEAKS - it is part of the picture, drawn in the pixels of the frame, never a subtitle and never a caption bar.
In the empty {{side}} third of the frame, well clear of his body, the words "{{highlight}}" are drawn straight into the air of the room in heavy condensed off-white capitals, stacked on short lines, with one thin warm-amber underline beneath them. There is no panel, no box, no bar and no background behind them: the letters sit alone against the out-of-focus classroom.
They snap into place word by word, EXACTLY as he says those same words in his sentence - not before, not after. They hold perfectly still and fully legible for about two seconds. Then they leave in one clean move, sliding out through the {{side}} edge of the frame, whole and still readable as they go - they never crumble, dissolve, glitch, flicker or break apart. Before they arrive and after they are gone, there is no writing anywhere in the picture.
He sits in the {{opposite_side}} part of the frame and the insert never touches him: it must never cross his face, his mouth, his eyes or his body at any moment. Flat and crisp: no shadow, no bevel, no glow, no 3D, no perspective, no motion blur.
```

### Variáveis

| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |
|---|---|---|---|---|---|
|`highlight`|Trecho literal da fala|`text`|por clipe|sim|—|
|`side`|Lado do insert|`text`|por clipe|sim|`right`|
|`opposite_side`|Lado da pessoa|`text`|por clipe|sim|`left`|

### Evidência de uso

- Recibos observados: 0, em null.
- Veredito humano de qualidade: não registrado.
- Amostras:

### Limites conhecidos

- A recusa da faixa em um contexto e sua aceitação em outro não isolam luminosidade como causa.
- O destaque deve ocorrer literalmente na fala; o quadro precisa reservar espaço para o insert.

## `gaze-entry@1` — Continuidade de olhar: entrada

- Status: `pilot`.
- Nível de validação: `unvalidated`.
- Estudos: nenhum registrado.
- Incompatibilidades: nenhuma declarada.
- Posição no prompt: `after-user`, ordem 34.
- Escopo: famílias `documentary`, `editorial`; tasks `reference_to_video`.

### Problema que evita

O giro deve começar ou terminar em movimento para permitir uma emenda dirigida.

### Bloco

```text
HOW THE SHOT BEGINS: the very first frame of this clip is already in motion - {{movement}} The movement is continuous from frame one: it does not start from stillness, and there is no pause, no fade and no settling before it. Once it completes, he holds that position and only then begins to speak.
```

### Variáveis

| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |
|---|---|---|---|---|---|
|`movement`|Direção e estado do movimento|`text`|por clipe|sim|—|

### Evidência de uso

- Recibos observados: 0, em null.
- Veredito humano de qualidade: não registrado.
- Amostras:

### Limites conhecidos

- Só constitui match cut se os planos forem adjacentes e a continuidade física for conferida. Artes entre eles produzem continuidade conceitual.

## `gaze-exit@1` — Continuidade de olhar: saida

- Status: `pilot`.
- Nível de validação: `unvalidated`.
- Estudos: nenhum registrado.
- Incompatibilidades: `clean-final-frame@1`.
- Posição no prompt: `after-user`, ordem 35.
- Escopo: famílias `documentary`, `editorial`; tasks `reference_to_video`.

### Problema que evita

O giro deve começar ou terminar em movimento para permitir uma emenda dirigida.

### Bloco

```text
HOW THE SHOT ENDS: after he finishes speaking he holds still for about a second, and then, in the last stretch of the clip, {{movement}} That movement is still happening when the clip ends - it is never completed, never settles, and there is no pause, no fade and no return to the starting position before the last frame.
```

### Variáveis

| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |
|---|---|---|---|---|---|
|`movement`|Direção e estado do movimento|`text`|por clipe|sim|—|

### Evidência de uso

- Recibos observados: 0, em null.
- Veredito humano de qualidade: não registrado.
- Amostras:

### Limites conhecidos

- Só constitui match cut se os planos forem adjacentes e a continuidade física for conferida. Artes entre eles produzem continuidade conceitual.

## `object-boundary-contract@1` — Estado do objeto na fronteira entre clipes

- Status: `concept`.
- Nível de validação: `unvalidated`.
- Estudos: nenhum registrado.
- Incompatibilidades: `clean-final-frame@1`.
- Posição no prompt: `after-user`, ordem 36.
- Escopo: qualquer estilo; tasks `text_to_video`, `image_to_video`.

### Problema que evita

A posição e o tamanho de um objeto podem saltar na emenda entre clipes independentes.

### Bloco

```text
BOUNDARY STATE: in the first frame, {{object}} is already moving {{direction}}. Its centre is at {{x}} of the picture width and {{y}} of its height; its diameter is {{diameter}} of the picture height. Preserve its size and direction. No arrival animation, no pause, no duplicate object.
```

### Variáveis

| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |
|---|---|---|---|---|---|
|`object`|Objeto|`text`|por clipe|sim|—|
|`direction`|Direção|`text`|por clipe|sim|—|
|`x`|x|`number`|por clipe|sim|—|
|`y`|y|`number`|por clipe|sim|—|
|`diameter`|diameter|`number`|por clipe|sim|—|

### Evidência de uso

- Recibos observados: 0, em null.
- Veredito humano de qualidade: não registrado.
- Amostras:

### Limites conhecidos

- Hipótese ainda não testada; comparar com encadeamento por frame é comparar estratégias, não apenas um fator.

## `clean-final-frame@1` — Estado final estável e sem fade

- Status: `pilot`.
- Nível de validação: `unvalidated`.
- Estudos: nenhum registrado.
- Incompatibilidades: nenhuma declarada.
- Posição no prompt: `after-user`, ordem 40.
- Escopo: famílias `motion-graphics`, `illustration`, `cinematic`, `editorial`, `documentary`, `social`, `produto`, `brand`; tasks `text_to_video`, `reference_to_video`, `image_to_video`.

### Problema que evita

Sem declarar o estado final, o clipe termina em movimento ou com fade e a emenda com o próximo lê como corte.

### Bloco

```text
End on {{end_state}}, clean stable final frame, no fade-out.
```

### Variáveis

| Nome | Rótulo | Tipo | Escopo | Obrigatória | Padrão |
|---|---|---|---|---|---|
|`end_state`|Estado exato do último frame|`text`|por clipe|sim|—|

### Evidência de uso

- Recibos observados: 0, em null.
- Veredito humano de qualidade: não registrado.
- Amostras:

### Limites conhecidos

- Continuidade real entre clipes continua sendo trabalho do shot-chain@1; este bloco só prepara o frame.

## Procedimentos do método

### `exclusive-voices@1` — Duas vozes em janelas exclusivas

- Tipo: audio; operação: `serie:grade`.
- Status: pilot; validação: unvalidated.
- Parâmetros: `sources`, `windows`, `overlapPolicy`.
- Evidências: .

O off e o som direto não podem disputar a mesma janela.

### `measured-two-pass-grid@1` — Grade medida em duas passadas

- Tipo: planning; operação: `serie:grade`.
- Status: pilot; validação: unvalidated.
- Parâmetros: `measurements`, `targetSeconds`, `margins`, `floors`.
- Evidências: .

A duração medida da fala governa a grade; mínimos inviáveis precisam ser reportados.

### `style-method-separation@1` — Estilo separado do método

- Tipo: planning; operação: `serie:prompts`.
- Status: pilot; validação: unvalidated.
- Parâmetros: `styleRef`, `invariants`.
- Evidências: .

Trocar estilo deve preservar as obrigações técnicas selecionadas.

### `act-music-crossfade@1` — Trilha por ato com cruzamento explícito

- Tipo: audio; operação: `serie:montar`.
- Status: pilot; validação: unvalidated.
- Parâmetros: `cues`, `crossfadeSeconds`, `fadeOutSeconds`.
- Evidências: .

Trilhas precisam cobrir os atos sem interromper o master antes do fim.

### `dual-voice-qa@1` — Verificação das vozes no master

- Tipo: qa; operação: `serie:qa`.
- Status: pilot; validação: unvalidated.
- Parâmetros: `script`, `windows`, `transcription`, `criteria`.
- Evidências: .

Contagem igual de palavras não comprova conteúdo, identidade de voz ou sincronismo.
