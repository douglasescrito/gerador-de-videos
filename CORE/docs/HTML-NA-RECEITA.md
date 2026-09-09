# HTML e Canvas na Receita Mestre

`html-canvas@1` usa o documento identificado por `graphics.scenes[].documentAssetId`. O executor existente renderiza o gráfico localmente sobre o vídeo da cena, preserva o áudio por stream-copy e encaminha o resultado para montagem, QA e entrega. Não cria app, servidor, executor ou chamada gerativa adicional. O template do piloto permanece disponível para sua invocação explícita; não substitui o documento de uma receita.

O asset deve ser `document/graphics-document`, MIME `text/html`, com origem `knowledge-core`, binding `scope-grant`, root, SHA-256 e bytes congelados. `recipe preflight --asset-context ...`, `run --asset-context ...` e `resume --asset-context ...` usam o mesmo contexto local já empregado por SFX e logo. Análise local e reuso precisam estar permitidos nos direitos vigentes. Compilar ou listar uma receita legada com caminho de workspace não autoriza executar o HTML: o preflight o apresenta como bloqueado.

Exemplo de uma entrada de `graphics.scenes`, dentro de uma receita completa:

```json
{"shotId":"abertura","renderer":"html-canvas@1","text":"ENCAIXE","documentAssetId":"grafico-autorizado"}
```

O documento é autocontido. HTML/CSS estáticos e animações CSS são aceitos; para controlar DOM ou Canvas 2D, defina `window.__setFrame(frame, total, scene)`. O terceiro argumento contém `text`, `width`, `height`, `fps`, `frameCount`, `durationSeconds`, `frame` e `timeSeconds`. O objeto global `studio` contém os dados imutáveis da cena, sem relógio corrente. A função pode retornar uma Promise. Exemplo de conteúdo do documento:

```html
<div id="texto" style="color:white;font-size:32px"></div>
<script>
  window.__setFrame = (frame, total, scene) => {
    const element = document.getElementById("texto");
    element.textContent = scene.text;
    element.style.transform = `translateX(${frame * 2}px)`;
  };
</script>
```

Cada documento roda em iframe de origem opaca dentro de um navegador descartável, sem sessão. CSP, contexto offline e interceptação de requests/WebSockets bloqueiam rede; downloads, cookies, acesso ao documento pai, service workers e subdocumentos são impedidos. Imagens/fontes embutidas no próprio documento fazem parte de seus bytes autorizados. Arial é embutida a partir do arquivo local hasheado; DOM e Canvas exigem essa família. Canvas WebGL e OffscreenCanvas não são suportados por esta rota.

O relógio é controlado por frame, a aleatoriedade de `Math.random` usa seed fixa e `Date.now`/crypto não ficam disponíveis como fontes de tempo ou entropia. Animações CSS recebem o tempo do frame. Uma barreira de pintura nos mundos isolados do frame e da página espera o compositor, sem expor o relógio nativo ao documento. Dimensões seguem o vídeo da cena e o aspecto congelado; fps/duração seguem a timeline. A contagem de frames é decodificada e conferida antes da publicação.

Direitos e bytes são revalidados antes da produção, antes de carregar o documento, antes da composição e antes da publicação. As entradas são hasheadas antes de renderizar; os executáveis de navegador/Node/FFmpeg e a fonte são conferidos novamente ao final. Recibos registram inputs, versão/hash das ferramentas, parâmetros, autorização, composição e pais; a montagem encadeia o recibo do gráfico consumido. O journal preserva o nó `html-motion:<cena>` e evita render repetido na retomada.

O consumidor `html-canvas@1.2.0` também recupera publicação parcial. Antes do render, um arquivo `binding.json` vincula entradas, parâmetros, ferramentas, destino e autorização. Antes de publicar o MP4, um `prepared.json` conserva o recibo preparado e o hash do temporário: esse marcador não declara entrega concluída. A retomada verifica os mesmos bytes e os direitos atuais, publica o temporário preservado ou completa o recibo ausente, sem novo render. Sem saída preparada, pode refazer apenas o processamento local, conferindo os metadados já existentes. Arquivo alheio, parâmetro divergente, conteúdo alterado ou saída legada sem vínculo são recusados sem sobrescrita.

O limite de parede vale para a etapa de captura no navegador e encerra esse navegador se excedido. A heap JavaScript é limitada por argumento do Chromium; não há limite de memória total do processo imposto pelo sistema operacional. O recibo explicita essa distinção: os campos de orçamento do manifesto não são prova de consumo real ou de limite de RSS. Não se promete determinismo entre versões de navegador, fonte ou ambiente distintas.

Provas automatizadas usam mídia física e Knowledge temporário: gráfico animado sobre fundo preservado, hashes iguais dos frames em duas execuções, igualdade dos pacotes de áudio, isolamento de cookies/pai, recusa de rede e de documento alterado, encerramento por limite de parede, master final com o gráfico, revogação de direito e retomada sem novo render ou POST. Para documento arbitrário, `exactText` fica `null`: oferecer o texto ao callback não comprova que o autor o desenhou nem substitui OCR/QA semântico. A integração e suas limitações estão no runbook.
