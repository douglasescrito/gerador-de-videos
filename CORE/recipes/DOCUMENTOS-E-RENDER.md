# Documento de produção e configuração de render

O [documento mestre](exemplo-documento-mestre.json) demonstra o contrato
production-spec@1: três blocos de narração, três cenas, alinhamento Whisper,
trilha, montagem, mix e entrega. Faça uma cópia e substitua os textos dos blocos
e USER_DOCUMENT_ID pelo documento Vids da sua própria conta. Não há foto, logo
nem overlays de texto nas cenas deste modelo.

Em CORE, o comando abaixo apenas valida e compila em memória:

    npm run video -- producao --spec recipes/exemplo-documento-mestre.json --format json

Ele não gera voz, imagens, vídeo, estado de execução ou master. A forma correta
do JSON não comprova que os placeholders foram preenchidos. Para iniciar uma
produção, siga o [contrato do CLI](../docs/AGENT-CONTRACT.md) e o
[fluxo audio-first](../templates/audio-first-multi-capitulos/README.md), com seus
assets, autorização e capacidades disponíveis.

A [configuração de estudo microscópico](nano-banana-motion.render.json) contém
dimensões, cores, textos de demonstração e o identificador técnico do tratamento
local. O nome histórico do arquivo e motionStyle identificam o adapter já
existente; não selecionam um modelo de IA. O tratamento usa HyperFrames, dura
seis segundos e possui 360 frames a 60 fps. Consulte render --help e o
[guia de motores locais](../docs/MOTORES-LOCAIS.md) para escolher o engine e fazer
dry-run antes de materializar um destino novo.

Esses dois contratos não são receita@1/receita@2: recipes:check não os descobre.
O documento tem seu compilador de production-spec; a configuração de render é
validada pelo renderer. Validação estrutural não é prova de render, sincronia
ou disponibilidade dos serviços. Preserve os originais de cada produção.

## Documentos antigos

O schema `mkt-videos/master-recipe@1` é reconhecido como autoria legada, mas
não possui conversão determinística implementada. O leitor retorna
`legado-bloqueado`, sem chamadas ao provedor. Não basta trocar o nome do schema
para executar um arquivo antigo: reconstrua a intenção no modelo neutro acima,
com textos e assets próprios, e valide o contrato correspondente. Opções escritas
num JSON histórico não comprovam capacidades atuais de narração, música ou QA.
