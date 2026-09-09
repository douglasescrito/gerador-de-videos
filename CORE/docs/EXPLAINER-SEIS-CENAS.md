# Explainer de seis cenas

O template técnico `adp-explainer@1` conserva o identificador de compatibilidade
do motor. Na distribuição, seu conteúdo é um exemplo genérico de processo:
entrada, identificação, combinação, conclusão, próxima etapa e visão geral.
Não contém a marca, o roteiro ou os dados operacionais da produção original.

As seis cenas preservam cards, setas com pontos em movimento, transformação
de identificador, convergência de entradas, remoção animada de item, relógios,
personagens geométricos, indicadores de progresso e grupos de quatro palavras
com destaque sincronizado. Tudo usa o renderer Canvas/Playwright existente.

`recipes/explainer-six-scenes.render.json` é um exemplo técnico silencioso de
12 segundos. Seus tempos de palavras são sintéticos para demonstrar o recurso;
não são evidência de narração gravada. Em uma produção falada, use palavras e
tempos medidos pelo Whisper, com o áudio real montado no fluxo Studio.

O preset reconhece cinco frases, nesta ordem: “primeiro confira”, “agora combine”,
“item pronto”, “mas atenção” e “para acompanhar”. Abertura e essas cinco entradas
formam as seis cenas. Frase ausente interrompe a preparação.

Para autoria de outro processo, importe `adpExplainerDocument` e
`DEFAULT_EXPLAINER_COPY` de `lib/media-pipeline/adp-explainer.mjs`. O builder
aceita o contrato de cena com `wordMotion`, mais `anchorPhrases` (cinco frases),
`explainerCopy` (substituições dos rótulos exportados) e `cuePrefixes` (dois
prefixos de palavras para transformação e conclusão). Rótulos aceitam até 100
caracteres; confira visualmente o encaixe no card ao mudar o conteúdo.

Essas opções avançadas pertencem ao builder do documento, não a novos campos
do editor ou do schema de cena. Grave o HTML retornado e use `documentFile` no
renderer local existente. O template não gera voz, não importa mídias e não
cria outro servidor ou executor. Os arquivos e testes da produção original
continuam preservados somente na origem.
