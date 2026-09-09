# Contrato de texto da narração e dos gráficos

Este contrato protege a segunda passagem do fluxo audio-first. A transcrição do
Whisper e a resposta de um LLM são evidências, nunca fontes editoriais.

## Autoridades

- **Texto narrado:** somente o roteiro aprovado.
- **Tempos:** somente os timestamps medidos pelo Whisper.
- **Texto gráfico:** somente `scene.onScreenText` da especificação aprovada.
- **LLM:** `proposal-only`; pode relacionar índices, mas não fornecer texto nem
  timestamps.

## Correção assistida por LLM

Quando o alinhamento determinístico bloqueia uma fronteira de token, o runtime
pode entregar ao corretor um `mkt-videos/llm-alignment-request@1`. A resposta
aceita é `mkt-videos/llm-alignment-proposal@1` e contém apenas:

- o fingerprint exato do pedido;
- um índice de token do roteiro;
- um ou mais índices contíguos de palavras medidas.

O runtime reconstrói a saída. Ele exige cobertura integral, ordem monotônica,
uso único de cada medição e similaridade lexical mínima. Assim, `Bem` +
`-vindo` pode ser vinculado a `Bem-vindo`, mas `transportou` não pode ser
publicado como `transforma`. Proposta inválida falha fechada e não autoriza nova
chamada ao Omni.

## Texto gráfico sincronizado

O plano `mkt-videos/graphics-text-plan@1` também contém somente índices: cena,
primeira palavra e última palavra da janela semântica. O texto final é copiado
da cena e os segundos são derivados da timeline canônica. Antes da chamada de
vídeo, o prompt recebe `VERIFIED GRAPHICS TEXT BINDING`, com texto e janela
imutáveis.

## Regras de execução

1. Nenhum prompt visual usa a transcrição bruta.
2. Nenhuma resposta do LLM é concatenada ao prompt do Omni.
3. O LLM não pode inventar, remover, traduzir ou reordenar palavras.
4. O LLM não pode criar ou ajustar segundos.
5. Todo binding prende fingerprints do roteiro, medição e proposta.
6. Falha de validação pausa a produção; nunca dispara retry automático.
7. Um adapter LLM externo continua sujeito ao registry de capacidades,
   autenticação autorizada e recibo próprio. A existência deste contrato não
   autoriza silenciosamente um novo provedor.
