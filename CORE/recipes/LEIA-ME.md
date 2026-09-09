# Receitas reutilizáveis

Esta pasta reúne modelos técnicos. Suas novas produções e derivações são locais
e não devem entrar no Git. Os [exemplos de Receita Mestre](EXEMPLOS-TECNICOS.md)
explicam os módulos avançados e os campos que precisam ser preenchidos.

Arquivos terminados em `.receita.json` ou `.receita-v2.5b.json` e variantes
equivalentes precisam declarar um schema conhecido e passar pelo validador do
motor. Documentos em construção usam `.rascunho.json`; planos de produção e
listas de jobs possuem contratos próprios e não devem fingir ser receitas.

| Schema | Uso | Validador |
| --- | --- | --- |
| `gerador-de-videos/receita@1` | Peça, lote ou filme | `recipe-compiler.mjs` |
| `gerador-de-videos/receita-sincronia-imagem@1` | Voz medida e imagens animadas | Schema dedicado |
| `gerador-de-videos/receita@2` | Receita Mestre com módulos e vínculos | `master-recipe-v2.mjs` |

Em `CORE`, execute `npm run recipes:check`. A checagem lê as receitas, sem gerar
mídia nem chamar provedores. Formatos novos precisam de registro em
`lib/media-pipeline/recipe-validation.mjs`, usando o validador de quem executa.

Validação estrutural não equivale a preflight nem a entrega. Uma receita pode
ter a forma correta e continuar bloqueada por assets ausentes, direitos,
autorização ou capacidade indisponível. Campos como COLE AQUI e USER_DOCUMENT_ID
podem passar na validação estrutural: substitua-os antes de gerar. Consulte a ajuda atual antes de executar e valide o
master físico depois da produção.

O [documento mestre e a configuração de render](DOCUMENTOS-E-RENDER.md) usam
contratos próprios e validadores distintos; consulte suas instruções.

## Escolher um ponto de partida

| Modelo | Estrutura e orientação |
| --- | --- |
| [Filme narrado](filme-1min-narracao-whisper-padrao.md) | Seis cenas, voz própria, alinhamento e montagem; comece pelo guia |
| [Integração de equipe](b2b-onboarding-cultura-60s.receita.json) | Quatro cenas: acolhimento, trabalho, propósito e próximos passos |
| [Apresentação de negócio](b2b-pitch-investidor-60s.receita.json) | Quatro cenas: problema, solução, evidências e convite; forneça fatos verificáveis |
| [Tipografia narrada](tipografia-intencao-10s.receita.json) | Uma janela de dez segundos; obtenha novos tempos da voz e leia o [guia](tipografia-intencao-10s.md) |
| [Planejamento de motion](ruptura-motion-arte-60s.processo.md) | Como ligar intenção visual, ritmo, voz, texto e finalização |

As durações são estruturas iniciais, não medições de uma voz já produzida.
Preencha roteiro completo e blocos de forma consistente, direção visual e musical,
id e coleção próprios. Configure o documento Vids da sua conta. O campo legado
fallbackPolicy não autoriza mudar o provedor de narração. Confira capacidades e
autorização pelo fluxo canônico antes da execução.
