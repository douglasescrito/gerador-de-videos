# Séries comerciais com conteúdo próprio

O comando `daily-commercials` mantém a lógica de ondas, capítulos, variações,
limites de chamadas, montagem, retomada e arquivamento. A missão fornece sua
política de marca e o conteúdo editorial; a distribuição não leva uma campanha pronta.

Em `mission.json`, `brand.brandKit` recebe um BrandKit válido criado pelo
construtor existente. `brandKitId` e `brandKitHash` precisam corresponder ao
objeto e ao seu hash. `logoFile` e `logoSha256` identificam a referência própria.
Isso não substitui a autorização de uso exigida na geração.

O objeto `editorial` define:

- `brandDisplayName`: nome que pertence à missão do usuário.
- `logoGuidance`: direção de uso da referência autorizada.
- `messages`: lista de premissas criativas para os comerciais.
- `copySequences`: listas de textos, com um texto por capítulo.

O planejador combina esses conteúdos com os mecanismos de movimento, composição,
territórios visuais, comportamento do logo, som e encerramento do motor. Ele não
busca automaticamente campanhas de outro usuário para preencher campos ausentes.

O perfil atual desta rotina exige formato 9:16 e seis capítulos por comercial.
A duração de cada clipe e o número de comerciais/ondas são configurados e
validados pelo módulo. A direção gerada usa essas durações, em vez de fixar
dez segundos por capítulo no texto do prompt.

Planeje com `npm run video -- daily-commercials --help` para conferir as ações
e flags. O estado impede abrir uma segunda onda enquanto uma anterior bloqueia
a continuidade. Não editar estado manualmente nem reenviar uma chamada ambígua.

Uma instalação com conteúdo legado pode continuar abrindo suas missões anteriores.
Os arquivos legados privados não acompanham a distribuição. Para uma missão nova,
preencha os objetos explícitos; não dependa de valores encontrados em outra máquina.

Validação técnica: a rotina foi empacotada em um diretório sem o módulo privado,
recebeu política e textos neutros e gerou um plano de seis jobs sem chamada a
provedor. Ausência de conteúdo e hash de política divergente foram rejeitados.
Isso comprova planejamento local; não comprova geração externa com uma conta nova.
