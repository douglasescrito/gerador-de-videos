# Quatro quadrantes e encerramento

`recipes/quadrants-motion.render.json` demonstra quatro interfaces animadas
simultâneas: notificações/chat, formas e estados, personagem no notebook com
cards em cascata e player com progresso/espectro. A composição termina com
uma transição para símbolo, título, frase e botão centralizados.

O identificador `focus-motion-zak@1` permanece por compatibilidade técnica.
A versão distribuída remove a marca, as promessas comerciais, os diálogos,
o endereço e a geometria do símbolo da produção original. O símbolo padrão
é uma composição genérica de quatro círculos; nenhum logo é lido do disco.
Os indicadores de player e notificações são ilustrativos, sem dados reais.

O preset exige proporção quadrada e 14,5 segundos. Ajuste resolução e fps no
contrato de cena existente. Ele não gera voz, trilha ou efeitos sonoros.

Para personalizar, importe `focusMotionZakDocument` e `DEFAULT_QUADRANT_COPY`
de `lib/media-pipeline/focus-motion-zak.mjs`. Passe `quadrantCopy` com as
substituições dos textos exportados (máximo de 80 caracteres por rótulo).
Verifique o encaixe visual nos cards; o limite não garante que todo texto caiba.

Opcionalmente, passe `quadrantLogoDataUri` com PNG/JPEG base64 previamente
autorizado pelo usuário. O callback de frame aguarda decode; uma imagem inválida
falha. A imagem própria aparece no encerramento, enquanto os ícones de interface
permanecem genéricos. O builder não baixa URLs nem busca logos em outputs.
Essas opções avançadas pertencem ao builder: grave o HTML e use documentFile no
renderer local existente. Não são novos campos do formulário/schema de cena.

Na cópia limpa, o teste percorreu nove instantes e repetiu um quadro anterior
com resultado idêntico. Também foram inspecionados os quadrantes e o encerramento
e renderizada uma variante com imagem geométrica incorporada, sem erros ou
requisições de rede. São provas de quadros, não de um master audiovisual.
