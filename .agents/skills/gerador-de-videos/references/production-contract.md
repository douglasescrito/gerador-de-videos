# Produção e validação

Apresente antes da geração uma tabela com Cena, Duração, Pessoa, Referência,
Fala/Narração, Texto em Tela e Trilha. Use o pedido como especificação por cena.

1. Separe presença da pessoa, fala em cena e narração off. Use referência de
   pessoa apenas nas cenas autorizadas em que ela aparece. Cenas puramente
   visuais usam text_to_video, sem herdar a referência de outra cena.
2. Não abra cenas com thumbnails, imagens temporárias ou último frame salvo
   quando isso fizer parte da direção solicitada.
3. Narração prevista deve existir como áudio real. Texto visual não substitui voz.
4. Alinhe textos à fala quando ambos forem solicitados. Não acrescente overlays
   a uma montagem que pede somente imagens; movimento pode sincronizar com a voz.
5. A trilha cobre a timeline e fica abaixo da voz. Não aplique fade-out automático.
   Preserve o arremate natural quando a receita o prevê; corte limpo na duração
   especificada. Faça essa escolha antes da geração e registre-a no plano.
6. Gere novos arquivos de montagem e acabamento, mantendo os originais.
7. Valide duração, vídeo, áudio, fala, trilha, sincronia e frames de abertura no
   master físico. Faça QA pelo pipeline existente; não invente prova sem observar.

Saídas em `CORE/outputs/<colecao>/`: originais em `videos-soltos`, masters em
`videos-unidos`, recibos em `receitas` e estado operacional em `metadados`.
Uma produção retomada reutiliza a coleção e o estado congelado. Não execute
um novo run apenas porque perdeu a observação da execução anterior.

O código do render local não pode acessar rede, cookies, filesystem não declarado
ou dependências baixadas implicitamente. Ambiente, fontes e arquivos usados
precisam permanecer presos ao binding registrado pelo renderer.
