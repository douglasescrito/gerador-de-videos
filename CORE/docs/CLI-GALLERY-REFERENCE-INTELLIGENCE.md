# CLI, Galeria e inteligência por referências

## Arquitetura canônica

O projeto possui uma única cadeia de produção e uma única interface de consumo:

```text
referências locais ── análise provider-free ── banco candidato validado
                                                   │
likes de vídeos ── evidência append-only ── sugestões de receitas no CLI
                                                   │
likes de receitas ── eventos append-only ── prioridade de combinações motion
                                                   │
decisão humana ── governança/promoção ── receita aprovada ── Studio CLI
                                                              │
                                          outputs + recibos ── Galeria de Vídeos
```

- **CLI**: único lugar que propõe, compila e executa receitas e produções.
- **Knowledge Core**: único lugar que pode promover conhecimento candidato para
  uso governado. Direitos, escopo, proveniência e decisão humana continuam
  obrigatórios.
- **Galeria de Vídeos**: navegação, reprodução, comparação, favoritos e uma
  prateleira de receitas sugeridas. Não cria variantes e não chama provedor.
- **Banco de motion**: material local de planejamento. Enquanto estiver em
  `status: candidate`, não altera receita, planner, `film-spec`, prompt efetivo
  ou entrada de provedor.

## Integração funcional atual

`variar-receitas` e `agendar-receitas` aceitam explicitamente `--motion-bank`.
O CLI relê os bytes, calcula SHA-256, confere `validation.json` e falha fechado
se status, escopo, fingerprints ou limites provider-free divergirem.

A orientação sai em `motionGuidance`, ao lado das receitas. Cada vínculo contém:

- receita, combinação, técnica principal e até duas técnicas de apoio;
- intenção, instruções, mapa de beats de 10 segundos, som e erros a evitar;
- hash e fingerprints da origem;
- limites explícitos: zero chamadas, nenhuma mutação de receita/prompt/planner e
  promoção humana obrigatória.

Exemplo somente leitura, sem gravar arquivo e sem chamar provedor:

```powershell
npm run video -- variar-receitas `
  --count 5 `
  --seed referencias `
  --favoritos-db .cache/archive-index.sqlite `
  --motion-bank diagnosticos/motion-reference-bank-20260812/instruction-bank.json `
  --format json
```

Para persistir uma nova prateleira candidata, use um caminho ainda inexistente
em `--out`. O CLI usa criação exclusiva e não sobrescreve receitas existentes.

## Feedback humano

O coração da preferência continua append-only:

1. A pessoa marca vídeos ou receitas como favoritos na Galeria.
2. Cada like e unlike de receita cria um novo evento imutável no mesmo
   `.cache/archive-index.sqlite`; o histórico anterior não é apagado.
3. O CLI lê estilos e combinações motion curtidos com `--favoritos-db`.
4. Estilos favoritos entram primeiro na ordem de sugestões de receitas, e
   combinações motion favoritas entram primeiro na distribuição de
   `motionGuidance` quando `--motion-bank` também é informado.
5. A identidade da receita e da combinação é validada pelo servidor contra a
   prateleira salva; campos motion enviados pelo navegador não são aceitos como
   autoridade.
6. Likes não geram vídeo, não consomem cota, não promovem regra, não alteram
   receita/prompt/planner e não escolhem automaticamente uma peça vencedora.

A primeira prateleira materializada está em
`recipes/sugestoes-motion-galeria.json`: dez receitas candidatas ligadas por
hash ao banco analisado, com zero chamadas de provedor.

Para transformar uma preferência recorrente em conhecimento canônico, o fluxo
continua sendo captura de feedback, candidato de interpretação, revisão humana e
canonicalização no mesmo `root_scope_id`.

## Organização dos artefatos

| Tipo | Local canônico | Papel |
| --- | --- | --- |
| Banco estudado | `diagnosticos/motion-reference-bank-20260812/` | evidência e candidato local |
| Conhecimento global promovido | `knowledge/` | regras versionadas e governadas |
| Receitas | `recipes/` | especificações escolhidas pela pessoa |
| Produções | `producoes/` | estado e autorização de uma produção |
| Entregas | `outputs/<colecao>/` | vídeos, recibos e metadados |
| Interface | `app/` | consumo e feedback, sem geração |

Arquivos do diagnóstico não devem ser copiados para `recipes/` ou `knowledge/`
apenas para “integrar” o projeto. A ligação é feita por hash e fingerprints;
isso evita duas fontes da verdade.

## Próximos incrementos

1. Materializar candidatos governados por técnica somente após direitos e
   `root_scope_id` válidos, usando o pipeline existente do Knowledge Core.
2. Permitir que uma preferência promovida influencie o contexto Studio; nunca o
   modo `raw`, nunca de forma silenciosa e sempre presa por hash ao plano.
