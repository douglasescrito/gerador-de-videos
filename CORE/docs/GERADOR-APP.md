# Gerador no app Studio

Entrada: `http://localhost:5599/gerador`, também pelo menu Home e pela página
de uma receita. Usa o servidor existente em `app/editor/server.mjs`.

## Meus vídeos e acompanhamento

O Início (`/`) é o lugar para criar, acompanhar e assistir. Mostra pedidos
recentes, busca e filtros por produção, ajuste, pronto e preparado. Acervo
continua a biblioteca de todos os arquivos locais; Receitas guarda as estruturas.
Um atalho persistente nas outras páginas leva à produção ativa ou ao último pedido.

Cada pedido tem endereço próprio (`/gerador?job=<id>`), independente do rascunho
no navegador. Durante a produção, formulário e passos de criação saem da tela.
O acompanhamento mostra estado, quatro grupos de trabalho, cenas disponíveis,
conexão e destino. O percentual conta etapas e cenas concluídas; não estima
tempo restante nem anima avanço fictício. Sem evidência inicial fica
indeterminado, e 100% exige `mediaAvailable` validado pelo servidor.

Erros de preparação mostram causa e ação. Falta de descrição musical leva
direto ao campo; a descrição legada da própria receita pode ser reutilizada
por um botão explícito, preservando os ajustes da mixagem. O campo é conferido
antes do envio. Falhas e preparações antigas continuam visíveis, sem reenvio
automático. O resultado final tem player e download no próprio pedido.

## Criação guiada

A entrada padrão mostra quatro passos: **Ideia**, **Aparência**, **Voz e música**
e **Revisar e gerar**. Criar um vídeo novo usa uma receita simples existente;
reaproveitar abre a biblioteca com busca e filtros. Os originais são preservados.
Tema, tempo total e proporção ficam em primeiro plano; nome, mensagem e público
ficam em Mais detalhes. Locução e trilha só revelam seus campos quando ativadas.

Os controles editam a receita canônica: divisão da duração entre as cenas,
catálogo de estilos, direção de ritmo, inserts nas cenas intermediárias livres,
arremate dentro do tempo final, texto de encerramento, voz Google Vids e música
Flow Music. Ao criar, o tema substitui o conteúdo do exemplo. Ajustes posteriores
de formato, ritmo e áudio preservam a direção manual das cenas. Ritmo, inserts e
arremate visual são instruções de geração; não representam efeitos já renderizados.

Logo, imagem e vídeo de referência mostram os materiais já vinculados à base.
As referências simples podem ser desativadas e restauradas. Assets avançados
mantêm seus vínculos e direitos; esta tela não faz upload de arquivos novos nem
concede autorização de uso. Bases com tempos, áudio e módulos sincronizados
preservam esses controles e explicam quando usar o editor avançado.

A revisão apresenta cenas, durações, referências, falas, textos e trilha antes
do envio. Avisos de preenchimento levam ao campo correspondente. **Gerar vídeo**
envia `autoStart: true` junto à versão congelada. O host existente registra essa
decisão no pedido e chama seu mesmo caminho de execução depois de `dry-run` e
`plan`, com o mesmo ID, hash e fingerprint, mesmo se o navegador sair da página.
A idempotência inclui essa decisão; nenhuma chamada depende de polling para
começar. Recarregar recupera o trabalho existente sem iniciar outra produção.
Preparações legadas sem essa decisão continuam exigindo clique explícito.
Reinício do servidor não retoma produção ambígua automaticamente.

**Editor avançado** mantém a mesa completa abaixo, acessível também por
`?advanced=1`. Alternar os modos preserva o mesmo rascunho. **Meus vídeos** abre
o Início com todos os pedidos; **Acompanhar no gerador** retoma sua visualização.

## Mesa compacta do editor avançado

O Gerador ocupa o viewport no desktop: projeto e ações no topo, biblioteca à
esquerda, monitor central, propriedades à direita e timeline fixa na base.
Cada painel rola internamente; biblioteca e propriedades podem ser recolhidas.
A aba Montagem abre diretamente o editor existente na mesma mesa, com seus
materiais e controles, sem repetir o cabeçalho do aplicativo. No celular os
painéis passam a uma sequência vertical, com rolagem horizontal só nas trilhas.

A timeline do roteiro apresenta imagem, texto em tela, voz e trilha. A régua
seleciona cenas e busca a posição correspondente na prévia local, quando há
mídia; a posição recuperada de um master continua identificada como estimada.
Zoom e Ajustar controlam a escala. A divisória muda a altura da timeline.
Cenas de `receita@1` sem áudio avançado vinculado podem ser reordenadas por
arraste e redimensionadas pela borda, entre 4 e 120 segundos. As setas na borda
ajustam um segundo; a régua aceita setas, Home e End. As alterações passam pelo
mesmo rascunho, histórico e validação existentes. Os vínculos dos outros
formatos permanecem nas propriedades e na receita completa, sem um segundo
modelo de execução. Duplo clique em uma cena leva ao campo de nome.

Uma faixa fixa destaca preparação, geração, exportação e revisão. Mostra as
etapas e a quantidade de cenas com vídeo disponível, sem porcentagem estimada.
As cenas da versão correspondente recebem estado individual na timeline;
editar o rascunho remove essa associação para não confundir versões. Produções
e histórico ficam em uma gaveta acessível também durante a edição.

## Criação

- Biblioteca local com busca e modelos de produto, história e motion.
- Edição de cenas, direção visual, duração, ordem, texto em tela e formato.
- Catálogo de estilos do núcleo e referências de pessoas vinculadas por cena.
  Uma instalação vazia não contém pessoa padrão nem fotos herdadas.
- Narração Google Vids, voz e documento de origem; edição dos blocos de falas
  existentes sem substituir a narração por texto visual.
- Trilha Flow Music com direção musical e sem fade automático.
- Desfazer/refazer, rascunho no navegador, edição de JSON e derivações salvas
  pela biblioteca canônica, com hash da origem e preservação dos originais.
- Personalização por tema, mensagem, público, duração, apresentador por cena
  e chamada final. Uma comparação de campos mostra exatamente a proposta antes
  de aplicar. Receitas com áudio ou tempos vinculados não são retimadas silenciosamente.
- Storyboard com miniaturas locais, falas, textos e duração. Materiais antigos
  aparecem como referência; derivações consultam a origem apenas se o hash confere.
  Vídeos disponíveis no estado da produção aparecem por cena durante a execução.
- Assistente Gemini pela operação text, sujeito à sessão e às capacidades
  disponíveis na própria conta. Uma falha do serviço não autoriza aplicar
  resposta incompleta nem repetir automaticamente a geração. A interface
  mantém a revisão manual das propostas.
- Painéis ajustáveis, foco persistido, prévia leve e atalhos Ctrl+S, Ctrl+Z,
  Ctrl+Shift+Z e F. Comparação entre origem e rascunho sem salvar a origem.

## Produção

Preparar salva uma derivação e chama `dry-run` e `plan` no CLI existente.
No modo guiado essa preparação integra o botão Gerar vídeo; no avançado
continua acessível separadamente. A interface apresenta o checklist antes do
envio. O clique de geração fica
vinculado ao estado, ao hash da receita e ao fingerprint do plano preparado.
O host HTTP usa argumentos separados, sem shell ou comandos livres.

`run`, `resume` e a aprovação de prévias legadas são os mesmos comandos do
Studio. O app não tem um segundo compilador, executor ou mecanismo de retries.
O modo automático usa `production-once`; a geração só começa por ação explícita.
Estados ambíguos não executam outro `run`. Retomar chama o executor existente,
responsável pela reconciliação e pelo reaproveitamento das etapas concluídas.

Os registros em `diagnosticos/gerador` são registros operacionais do host HTTP,
não um banco de entidades ou um novo journal de execução. São persistidos antes
de iniciar o processo e pedidos repetidos com o mesmo ID são idempotentes.
O journal, as autorizações e os artefatos produtivos continuam no núcleo.

## Editor e compatibilidade

O editor experimental existente está embutido com área ampliada, materiais,
monitor, trilhas, waveform, seleção, zoom, reprodução e busca por corte.
Os tempos da receita permanecem planejamento; a montagem física é lida dos
arquivos e recibos existentes. “Editar uma cópia” permite entrada/saída,
divisão no cursor (S), ordem, remoção, nome, ganho e texto acima/centro/abaixo.
Desfazer/refazer e comparação com o original preservam a edição local.
O ganho é ouvido na prévia pelo Web Audio. O áudio já mixado acompanha o corte;
falas e textos gravados no MP4 não se tornam camadas separadas automaticamente.

“Exportar MP4” resolve IDs de materiais, revalida versão e fonte e chama
`join --mode studio` com `gerador-de-videos/assembly-edit@1`. É uma extensão
do `assembleFilm` existente: sem segundo renderizador ou executor. O manifesto
registra hashes das fontes; o CLI verifica os bytes antes de renderizar.
Saídas em `outputs/edicao-<id>/videos-unidos/master.mp4`, com manifesto e recibo.
Suporta 16:9, 9:16 e 1:1 por ajuste com margens, fontes sem áudio, cortes e ganho
de −60 a +12 dB. A exportação usa H.264/AAC, até 100 trechos e uma hora.
Os originais não são sobrescritos e uma requisição repetida não exporta de novo.

Execução nesta tela: `receita@1` do tipo `filme` e `receita@2` individual quando
o compilador e o runtime os suportam. Lotes e receitas de sincronia com executor
especializado continuam editáveis. A biblioteca já mostra “Pode preparar”,
“Precisa de ajustes” ou “Edição e acervo”, com motivos. O primeiro estado indica
aceitação estrutural, sem prometer direitos, sessão ou admissão de execução.
Módulos avançados, seus assets e vínculos permanecem na receita completa
e sujeitos aos validadores e aos direitos do núcleo; não são descartados para
forçar uma geração. Sessões expiradas ou recursos indisponíveis não são simulados.

## Instalação e verificação

Consulte [Instalação Windows](INSTALACAO-WINDOWS.md) para requisitos, início
e configuração das próprias contas. Não copie sessões, fotos, receitas pessoais
ou históricos da instalação de origem. A biblioteca vazia não é uma falha: seus
próprios materiais e produções aparecerão conforme forem criados.

Os testes incluídos no pacote são executados com npm test em CORE, sem contas
reais. Verificações de interface e contratos não comprovam disponibilidade
de cada provedor para o usuário. O primeiro uso de geração externa exige sua
própria sessão, capacidades e referências autorizadas.

As rotas do gerador restringem Host/Origin ao Studio local, exigem JSON e token
de sessão local para POST, limitam o corpo e confinam entregas a outputs.
O token do app não é credencial de provedor. Diagnósticos e evidências pessoais
de produção da instalação original não acompanham o projeto.
