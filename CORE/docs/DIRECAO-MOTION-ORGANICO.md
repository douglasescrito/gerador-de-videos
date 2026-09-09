# Direção de motion orgânico para receitas Studio

Guia de autoria técnica para o adapter HyperFrames existente. Não acrescenta um
renderer, preset executável, editor gráfico ou aprovação editorial automática.
Descrever estas instruções numa receita não implementa seus movimentos no template.

Aplicação disponível: `organic-launch@1`, em `lib/media-pipeline/organic-launch.mjs`,
implementa a direção para o roteiro específico de lançamento. Consulte
[Motores locais](MOTORES-LOCAIS.md) para o contrato e as limitações. A receita
e os áudios da produção de origem não acompanham esta distribuição.
O guia permanece orientação de autoria, e os controles não constituem um Graph
Editor visual na interface.

## Estrutura antes dos efeitos

Escrever a ação que demonstra a ideia e identificar o objeto que a executa.
Cada passagem precisa declarar: estado de entrada, ação, consequência visível,
objeto que permanece, estado de saída e momento de leitura. A transição começa
na composição anterior. Um painel pode ocupar a tela, receber um comando,
apresentar o resultado e se tornar uma peça do conjunto seguinte.

Manter um protagonista por passagem e poucos apoios. A quantidade cresce somente
quando a mensagem trata de variedade, comparação ou conjunto. Hierarquia depende
de escala, contraste, sobreposição e foco; não de preencher espaços com ornamentos.
Uma galeria deve conter resultados com função, não cartões vazios de decoração.

A câmera revela relações existentes no espaço: aproxima para mostrar um detalhe,
afasta para mostrar sua consequência, acompanha a seleção até o destino. Definir
o destino antes de animar. Movimento durante leitura precisa preservar o eixo
de atenção. Não manter a câmera ou todas as camadas oscilando para simular vida.

## Escolha do mecanismo

| Intenção | Mecanismo de autoria | Evidência esperada |
| --- | --- | --- |
| Mesmo objeto em novo arranjo | Layout inicial/final medido; transformações equivalentes a FLIP | Mesma identidade, conteúdo e ponto de apoio durante o percurso |
| Detalhe que revela o conjunto | Câmera virtual sobre um mundo comum | O objeto anterior continua localizável no plano aberto |
| Superfície que vira a próxima cena | Máscara e enquadramento derivados da mesma superfície | Borda, direção e material atravessam a passagem sem salto |
| Controle que modifica resultado | Cursor, controle e efeito com dependência temporal explícita | A resposta começa após a ação e corresponde à propriedade alterada |
| Palavra ou frase que aparece | Máscara de linha/palavra, posição e opacidade | Métricas, contraformas, acentos e linha de base preservados |
| Forma que muda de topologia | Desenho específico dos dois estados e correspondência revisada | Estados intermediários fazem sentido visual |
| Material vivo dentro de painel | Cor/luz/textura determinísticas independentes do contêiner | Material evolui enquanto bordas e texto podem permanecer imóveis |

Morph de contornos de palavras inteiras não é mecanismo padrão desta direção.
Ligar contornos somente pelo índice não estabelece correspondência entre letras
e contraformas. Para texto, preferir mudanças de disposição, revelação e recorte.
Um efeito breve de troca de caracteres pode existir quando necessário à narrativa;
tem começo e fim explícitos e não ocupa a janela da palavra falada que precisa
ser compreendida. Não aplicar liquefação global, achatamento extremo ou ruído aos
glifos para substituir desenho tipográfico.

## Curvas com função

Para cada propriedade, registrar unidade, valores inicial/final, início, duração,
curva, velocidade pretendida na entrada e na saída e dependência com a ação.
Translação, escala, máscara e material são canais distintos. Quando devem manter
um alvo travado, compartilham a mesma progressão temporal e geometria coerente.

Pontos de partida de autoria, não curvas extraídas de um vídeo:

| Papel | Curva candidata | Aplicação |
| --- | --- | --- |
| Chegada com cauda longa | `power3.out` | Resultado entra, desacelera e fica disponível para leitura |
| Viagem com repouso nas pontas | `power3.inOut` | Reenquadramento entre dois focos |
| Tempo material contínuo | `none` | Evolução interna finita de uma superfície |
| Texto revelado | `power2.out` | Deslocamento curto dentro de máscara, seguido de sustentação |

Ajustar duração e distância ao gesto observado. Não aplicar a mesma curva a tudo.
Se o movimento atravessa uma emenda, avaliar posição **e velocidade** nos dois
lados. Uma curva que zera a velocidade no corte não serve para uma travessia
contínua. Projetar a passagem sobre um intervalo comum ou casar as derivadas.
Para leitura, chegar a repouso é desejável. Overshoot exige motivo específico;
não usar `back`, `elastic` ou `bounce` como assinatura automática de qualidade.

No mundo 2D, com origem central, um alvo a deslocamento `d` e escala `S` exige
translação de tela `T = -d*S` para manter o centro. Com wrappers aninhados,
`scale(S)` externo e `translate(-d)` interno produzem a mesma relação. Congelar
o layout após resolver fontes; não medir o DOM repetidamente durante captura.

## Tipografia e áudio

Definir a composição estática com hierarquia, espaçamento, largura de linha e
contraste antes de animar. Escala de texto acompanha sua função na mensagem.
Estilização pode vir de corte, peso, enquadramento, contraste e luz na superfície.
O texto precisa sobreviver à animação com sua forma reconhecível.

Usar o alinhamento Whisper da locução material efetivamente mixada. O resultado
visual importante resolve na âncora correspondente; a preparação pode preceder
a palavra. Não transformar cada palavra da narração em uma nova cena. Revelar
somente os elementos necessários à fala atual, deixando desenvolvimento para os
momentos seguintes. Trilha, efeitos e voz continuam nas etapas Studio explícitas.
Preservar o arremate natural, sem fade-out automático.

## Implementação dentro da casa

O worker atual chama `__setFrame` por meio de `__hf.seek`; os templates cinéticos
existentes desenham Canvas. O template `premium-morph@1` não contém uma timeline
GSAP de coreografia. Instalar HyperFrames não transforma esse desenho em outra
linguagem visual.

Uma evolução deve permanecer no mesmo adapter, com template interno versionado,
entrada JSON validada e dependências/fontes vinculadas por hash. Se utilizar GSAP,
incorporar o pacote fixado localmente, registrar a timeline pausada de forma
síncrona e dirigir o tempo pelo frame. Verificar a integração com o runtime
HyperFrames, sem introduzir um segundo relógio. Não carregar CDN, Google Fonts,
HTML arbitrário nem instalar skills do projeto externo durante render.

Propriedades de câmera ficam no pai; conteúdo e detalhes, nos filhos. Um único
autor controla cada propriedade em cada intervalo. Estados iniciais explícitos,
tempo finito, ausência de relógio de parede e captura determinística. Validar
seek direto e retrocesso além da reprodução sequencial; um estado não pode depender
do frame visitado antes. A leitura das regras externas não autoriza copiação de
seus harnesses, servidores ou políticas para o Studio.

## Revisão concreta

Antes de um master longo, conferir a passagem de maior dificuldade dentro da
autorização da produção: pose inicial, transporte, passagem intermediária e pose
final. Inspecionar também o movimento em velocidade normal. Uma prancha estática
não comprova fluidez. Registrar defeitos observáveis — perda de identidade,
salto, colisão, letra ilegível, pausa ausente, foco perdido — em vez de nota estética.

Aplicar a gramática definida ao filme completo. Cores ou fontes diferentes sobre
a mesma sequência de deformações não constituem novas propostas de direção.
Validação de streams e hashes comprova integridade técnica; não comprova que o
filme comunica bem. Correções e renderização seguem o executor e a política de
tentativas existentes, preservando originais.

## Fontes técnicas consultadas

- [HyperFrames: keyframes e escolha de mecanismo](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-keyframes/SKILL.md).
- [HyperFrames: linguagem de movimento para produto](https://github.com/heygen-com/hyperframes/blob/7a2a6917367e6dd7ce22f4c321c4a852dcf58dfd/skills/product-launch-video/references/motion-language.md).
- [HyperFrames: câmera e alvo](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-animation/rules/coordinate-target-zoom.md).
- [Exemplo oficial: canvas contínuo de produto](https://github.com/heygen-com/hyperframes/blob/7a2a6917367e6dd7ce22f4c321c4a852dcf58dfd/registry/examples/product-promo/compositions/scene2-4-canvas.html).

O exemplo ensina continuidade e relações de UI; contém CDN, transição CSS e uso
frequente de `back.out`, que não devem ser transportados como padrão para esta
direção. As próprias orientações atuais de produto recomendam acomodação suave.
Este documento adapta mecanismos ao contrato local; não afirma que o projeto de
origem da referência foi feito com HyperFrames.
