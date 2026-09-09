# Diretores de marketing por cliente e projeto

O comando `director` adiciona direção criativa governada ao Studio sem criar um
segundo gerador. O CLI permanece como única superfície de planejamento e
execução; a Galeria apenas apresenta perfis, evidências e variações.

## Modelo

Cada diretor é um `entity-profile@1` privado do Knowledge Core dentro de dois
escopos: `client:<cliente>` e `project:<cliente>:<projeto>`. Uma release ativa
congela a revisão aprovada. Não há arquivo de cliente ou banco paralelo como
fonte de verdade.

O perfil define posicionamento, linguagem principal, arquétipos publicitários,
modos de locução, transições, técnicas motion, regras de marca e contrato de
áudio. O hash do banco de referências prende o repertório à análise validada.

## Fluxo de um ciclo

```text
perfil ativo + likes append-only + fingerprints recentes
                         │
                         ▼
                 director context
                         │
                  brief + receita
                         │
                         ▼
                director validate
                         │
                  film-spec@2 / plano
                         │
                         ▼
                 executor Studio atual
```

`context` e `validate` são provider-free. A validação não chama Omni, Vids ou
Flow; apenas bloqueia uma receita que atravesse escopo ou viole o perfil.

## Comandos

```powershell
npm run video -- director --action sync-preferences
npm run video -- director --action context --client meu-cliente --project meu-projeto
npm run video -- director --action validate --client meu-cliente --project meu-projeto --brief <director-brief.json> --recipe <receita.json> --out <director-validation.json>
npm run video -- director --action register --input <perfil.json> --confirm-human true
```

O registro é decisão humana explícita. Um novo cliente reutiliza o mesmo schema,
com outro `clientId` e `projectId`.
O painel descobre os perfis ativos diretamente pela release do
`KNOWLEDGE_ROOT_SCOPE_ID`; não existe uma lista paralela de pares cliente/projeto.

## Aprendizado por referência

Likes/unlikes do app desktop são importados uma única vez para o ledger
append-only canônico. Likes de vídeos e receitas têm autoridade
`suggestion-only`: podem orientar a escolha entre opções já permitidas, mas não
promovem conhecimento, não alteram o perfil, não ranqueiam conteúdo e não
disparam geração. Promoção continua sendo decisão humana separada.

## Configurar seu perfil

Defina linguagem visual, estrutura narrativa, locução e contrato de áudio para
o seu projeto. Escolha técnicas do catálogo, preserve a referência de versão e
registre somente assets próprios com direitos explícitos. Nenhum perfil privado
ou release do autor acompanha esta distribuição.
