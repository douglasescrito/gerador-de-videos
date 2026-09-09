# ADR 0001 — Uma espinha, um planner canônico e um journal

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita
- Estado da implementação: parcial, com compatibilidade legada em rollout
- Data: 2026-07-23
- Escopo: planejamento e execução de produções `studio`
- Decisores: mantenedores do MKT VIDEOS

## Contexto

O projeto já possui contratos e componentes suficientes para uma espinha
canônica:

- `film-spec@2`;
- `recipe@2`;
- `timeline@1`, com evolução prevista para `timeline@2`;
- `execution-plan@1`;
- `film-compiler.mjs`;
- `execution-journal.mjs`;
- adapters, artefatos e recibos.

Também existe uma superfície legada em `film-orchestrator.mjs` e um mecanismo de
rollout em `executor-rollout.mjs`. Criar outro planner, executor ou banco de
estado para receber Knowledge Core, HTML ou novos providers produziria
divergência de fingerprints, orçamento, reconciliação e proveniência.

Neste ADR, **planner canônico** significa a transformação determinística de
`film-spec@2` em `execution-plan@1`. Advisors criativos podem propor decisões e
materializar artefatos, mas não são planners de execução.

## Decisão

A cadeia canônica de uma produção `studio` é:

```text
brief estruturado
  + knowledge-context congelado
  + decision artifacts aprovados
  + capability snapshot
          ↓
film-spec@2
          ↓
film-compiler.mjs
          ↓
execution-plan@1 + fingerprint
          ↓
execution-journal.mjs
          ↓
adapters
          ↓
artefatos + recibos
```

As responsabilidades ficam fixadas assim:

1. `film-spec@2` é a entrada declarativa canônica do planejamento.
2. `film-compiler.mjs` é o único dono da compilação para
   `execution-plan@1`.
3. O compilador é determinístico e não chama modelos, providers, renderers,
   rede ou banco privado.
4. Qualquer modelo de raciocínio roda antes do compilador e entrega um artefato
   estruturado, validado e hasheado.
5. `execution-journal.mjs` é o ledger canônico para novas capacidades de
   execução retomável.
6. O journal registra eventos, tentativas, autorizações, handles de
   reconciliação e resultados; snapshots são projeções reconstruíveis.
7. Adapters executam nós do plano, nunca inventam novos nós ou alteram o plano
   durante a execução.
8. CLI e app deverão atravessar o mesmo application service antes de novas
   capacidades serem expostas nas duas superfícies.
9. `timeline@2` será uma evolução do contrato temporal atual, não uma timeline
   paralela exclusiva de HTML.

## Compatibilidade legada

`film-orchestrator.mjs` continua permitido somente como:

- fachada de compatibilidade;
- leitor de estados históricos;
- adapter entre o plano canônico e o formato legado;
- caminho de rollback durante a convergência.

`executor-rollout.mjs` continua permitido para:

- migração em `shadow`;
- comparação de equivalência;
- rollback controlado.

Nenhuma capacidade nova deve nascer apenas no executor legado. Uma nova classe
de nó precisa ser representável no `execution-plan@1` e no journal antes de
ganhar um caminho produtivo.

A remoção da compatibilidade legada exige:

- inventário dos estados ainda ativos;
- migração e replay;
- equivalência de snapshots;
- testes de crash e reconciliação;
- ADR posterior;
- rollback documentado.

## Invariantes

- Há um único símbolo público `compileFilmSpec`.
- Há um único dono do schema `execution-journal@1`.
- O mesmo conjunto normalizado de inputs produz o mesmo plano e fingerprint.
- Retrieval não acontece em `run` nem em `resume`.
- Mudança semântica cria novo plano e novo fingerprint.
- Estado ambíguo nunca autoriza outra tentativa.
- Operação paga nunca nasce de feedback, QA ou decisão de adapter.
- Uma projeção não se torna fonte de verdade.

## Consequências

### Positivas

- Omni, HTML, TTS, música e FFmpeg passam a ser operadores da mesma produção.
- Orçamento, autorização e reconciliação permanecem centralizados.
- Replays e auditorias podem reconstruir por que cada artefato existe.
- Novas ferramentas não exigem outro CLI ou outro servidor.

### Custos

- A convergência do executor precisa ocorrer antes da expansão ampla de tipos de
  nó.
- A fachada legada continuará temporariamente, aumentando a superfície testada.
- Novos adapters terão de atender ao contrato do kernel em vez de executar
  diretamente por conveniência.

## Alternativas rejeitadas

### Criar um “planner de IA” separado

Rejeitado porque sua saída não teria a mesma estabilidade, governança e
fingerprint do compilador determinístico.

### Criar um executor para HTML

Rejeitado porque dividiria estado, orçamento, timeline, receipts e tratamento
de falhas.

### Manter executor legado e journal indefinidamente como pares

Rejeitado porque duas fontes de verdade inevitavelmente divergem.

## Fitness associada

As verificações iniciais ficam descritas em
`docs/ARCHITECTURE-BOUNDARIES.md`. Nesta fase, a suíte:

- fixa os owners canônicos existentes;
- impede imports de providers pelo compilador;
- detecta duplicação dos símbolos canônicos.

Equivalência completa do executor e uso exclusivo do journal permanecem gates
de fases posteriores, não alegações da Fase 0.
