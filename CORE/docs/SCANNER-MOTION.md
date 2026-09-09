# Scanner e telemetria ilustrativa

O template conserva o identificador técnico `nano-banana-motion@1` para
compatibilidade. A versão distribuída não inclui nem procura a imagem da
produção original. O padrão desenha um objeto geométrico animado no Canvas.

Preserva aproximação de câmera, parallax, varredura luminosa, três miras,
marcadores de canto, painéis de telemetria, barras de espectro e duas fases de
título. Os números e o espectro são ilustrações animadas, não medições do objeto
ou do áudio. A composição é quadrada; sua timeline de seis segundos escala
proporcionalmente à duração escolhida.

Use `recipes/scanner-motion.render.json` como exemplo no renderer existente.
Para autoria com imagem própria, importe `nanoBananaMotionDocument` de
`lib/media-pipeline/nano-banana-motion.mjs` e passe uma cena com width, height,
fps, durationSeconds e `scannerImageDataUri`: PNG ou JPEG em data URI base64.
O builder não lê arquivos nem baixa URLs. Incorpore somente uma imagem que
você tenha autorizado para a produção; a codificação base64 não concede direitos.

`scannerCopy` aceita header, title e result, até 48 caracteres cada. Essas
opções pertencem ao builder avançado do HTML, não ao formulário ou ao schema
de cena. Use o HTML retornado como documentFile no renderer local existente.
O callback de frame aguarda a decodificação da imagem; imagem inválida falha,
sem substituir silenciosamente seu conteúdo pelo objeto padrão.

As miras são elementos gráficos em posições fixas: não rastreiam pontos reais
da fotografia. Ajustes de composição continuam necessários para cada imagem.
O template não gera trilha, narração ou SFX; essas etapas pertencem ao Studio.

Na cópia limpa, Playwright verificou quatro instantes de cada versão (objeto
procedural e PNG sintético), com repetição exata de um instante, sem erros ou
requisições. Essa prova cobre quadros renderizados, não um master audiovisual.
