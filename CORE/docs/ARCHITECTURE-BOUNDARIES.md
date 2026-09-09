# Boundaries e matriz de fitness arquitetural

> A matriz abaixo documenta a evolução arquitetural. O teste de fitness verifica
> componentes, imports e owners; ele não comprova sozinho todos os comportamentos
> da matriz. A validação da distribuição é registrada separadamente. Para operação
> atual, prevalece o [contrato do CLI](AGENT-CONTRACT.md).

Este documento é a fonte versionada dos limites arquiteturais introduzidos na
Fase 0 e automatizados pelas fundações provider-free das Fases 1, 2, 3, 4.1,
4.2, 4.3, 4.4, 4.5, 5, 6, 6A, 7, 8, 9 e 10 do
Video Studio Inteligente. Ele separa:

- decisões já aceitas;
- verificações que podem ser executadas sobre o código atual;
- gates que só podem ser automatizados quando o componente correspondente
  existir.

Não é um mapa de features. É um contrato de dependências, autoridade e efeitos
colaterais.

## Manifesto executável

O bloco JSON abaixo é consumido por
`test/architecture-fitness.test.mjs`. Alterações no bloco devem ser revisadas
como mudanças arquiteturais.

<!-- architecture-fitness-manifest:start -->
```json
{
  "schema": "mkt-videos/architecture-boundaries@1",
  "revision": 35,
  "status": "phase-10-decision-shadow-console",
  "decisionRefs": [
    "docs/adr/0001-uma-espinha-um-planner-um-journal.md",
    "docs/adr/0002-boundaries-raw-studio-knowledge.md",
    "docs/adr/0003-armazenamento-privado-e-runtime-guard.md",
    "docs/adr/0004-backup-single-root-e-inventario-governado.md",
    "docs/adr/0005-payloads-tipados-e-fechamento-de-referencias.md",
    "docs/adr/0006-knowledge-packs-globais-versionados.md",
    "docs/adr/0007-ontologia-audiovisual-global-candidata.md",
    "docs/adr/0008-referencias-direitos-e-estudo-provider-free.md",
    "docs/adr/0009-autorizacao-direta-de-provider-input.md",
    "docs/adr/0010-execution-authorization-e-kernel-jit.md",
    "docs/adr/0011-feedback-append-only-e-replay-provider-free.md",
    "docs/adr/0012-candidato-de-interpretacao-de-feedback.md",
    "docs/adr/0013-policy-registry-e-scope-grant-attestation.md",
    "docs/adr/0014-fila-promocao-e-decisoes-humanas-de-feedback.md",
    "docs/adr/0015-one-shot-e-supersessao-de-feedback.md",
    "docs/adr/0016-canonicalizacao-de-preferencia-por-feedback.md",
    "docs/adr/0017-retrieval-shadow-fts5-e-contexto-read-only.md",
    "docs/adr/0018-contexto-congelado-no-compilador-e-recibos.md",
    "docs/adr/0019-convergencia-do-executor-e-replay.md",
    "docs/adr/0020-timeline-v2-motion-ir-e-renderer-contract.md",
    "docs/adr/0021-compositor-hibrido-e-cadeia-de-recibos.md",
    "docs/adr/0022-contrato-de-adapters-e-conformance.md",
    "docs/adr/0023-creative-console-read-only-e-trace.md",
    "docs/adr/0024-decision-resolver-admissibility-preference-viability.md",
    "docs/adr/0025-decision-artifacts-hash-bound-no-authority.md",
    "docs/adr/0026-plan-capability-and-compiler-binding.md",
    "docs/adr/0027-feedback-capture-route-human-gated.md",
    "docs/adr/0028-creative-console-evaluation-shadow-projection.md",
    "docs/adr/0029-preference-ranker-shadow.md",
    "docs/adr/0030-release-governance-projection.md",
    "docs/adr/0031-feedback-target-verification.md",
    "docs/adr/0032-hybrid-pilot-readiness-gate.md",
    "docs/adr/0033-hybrid-pilot-manifest-bridge.md",
    "docs/adr/0034-decision-shadow-console-projection.md"
  ],
  "canonicalComponents": [
    {
      "role": "film-spec",
      "path": "schemas/film-spec-v2.schema.json"
    },
    {
      "role": "execution-plan",
      "path": "schemas/execution-plan.schema.json"
    },
    {
      "role": "canonical-compiler",
      "path": "lib/media-pipeline/film-compiler.mjs"
    },
    {
      "role": "studio-context-boundary",
      "path": "lib/media-pipeline/studio-context.mjs"
    },
    {
      "role": "execution-journal",
      "path": "lib/media-pipeline/execution-journal.mjs"
    },
    {
      "role": "execution-authorization",
      "path": "lib/media-pipeline/execution-authorization.mjs"
    },
    {
      "role": "execution-effect-kernel",
      "path": "lib/media-pipeline/execution-kernel.mjs"
    },
    {
      "role": "legacy-compatibility-facade",
      "path": "lib/media-pipeline/film-orchestrator.mjs"
    },
    {
      "role": "executor-rollout",
      "path": "lib/media-pipeline/executor-rollout.mjs"
    },
    {
      "role": "timeline-motion-ir-shadow",
      "path": "lib/media-pipeline/timeline-ir.mjs"
    },
    {
      "role": "renderer-contract-sandbox",
      "path": "lib/media-pipeline/renderer-contract.mjs"
    },
    {
      "role": "hybrid-compositor",
      "path": "lib/media-pipeline/hybrid-compositor.mjs"
    },
    {
      "role": "adapter-contract-shadow",
      "path": "lib/media-pipeline/adapter-contract.mjs"
    },
    {
      "role": "creative-console-readonly",
      "path": "lib/media-pipeline/creative-console.mjs"
    },
    {
      "role": "timeline-preview",
      "path": "lib/media-pipeline/timeline-preview.mjs"
    },
    {
      "role": "knowledge-decision-resolver-shadow",
      "path": "lib/media-pipeline/knowledge-decision-resolver.mjs"
    },
    {
      "role": "studio-decision-artifacts",
      "path": "lib/media-pipeline/studio-decision-artifacts.mjs"
    },
    {
      "role": "knowledge-store",
      "path": "lib/media-pipeline/knowledge-store.mjs"
    },
    {
      "role": "knowledge-service",
      "path": "lib/media-pipeline/knowledge-service.mjs"
    },
    {
      "role": "knowledge-retrieval",
      "path": "lib/media-pipeline/knowledge-retrieval.mjs"
    },
    {
      "role": "knowledge-action-registry",
      "path": "lib/knowledge-actions.mjs"
    },
    {
      "role": "knowledge-feedback-ledger-contract",
      "path": "lib/media-pipeline/knowledge-feedback.mjs"
    },
    {
      "role": "knowledge-schema-registry",
      "path": "lib/media-pipeline/knowledge-schema-registry.mjs"
    },
    {
      "role": "knowledge-record-contracts",
      "path": "lib/media-pipeline/knowledge-record-contracts.mjs"
    },
    {
      "role": "knowledge-governance-envelope",
      "path": "lib/media-pipeline/knowledge-governance-envelope.mjs"
    },
    {
      "role": "knowledge-policy-registry",
      "path": "lib/media-pipeline/knowledge-policy-registry.mjs"
    },
    {
      "role": "knowledge-backup",
      "path": "lib/media-pipeline/knowledge-backup.mjs"
    },
    {
      "role": "knowledge-asset-integrity",
      "path": "lib/media-pipeline/knowledge-asset-integrity.mjs"
    },
    {
      "role": "knowledge-schema-replay",
      "path": "lib/media-pipeline/knowledge-schema-replay.mjs"
    },
    {
      "role": "knowledge-candidate-importers",
      "path": "lib/media-pipeline/knowledge-importers.mjs"
    },
    {
      "role": "global-domain-pack-catalog",
      "path": "lib/media-pipeline/knowledge-domain-pack-catalog.mjs"
    },
    {
      "role": "global-domain-pack-action",
      "path": "lib/media-pipeline/knowledge-domain-pack-action.mjs"
    },
    {
      "role": "global-audiovisual-ontology",
      "path": "lib/media-pipeline/knowledge-audiovisual-ontology.mjs"
    },
    {
      "role": "reference-inventory",
      "path": "lib/media-pipeline/knowledge-reference-inventory.mjs"
    },
    {
      "role": "reference-cohort-rights",
      "path": "lib/media-pipeline/knowledge-reference-rights.mjs"
    },
    {
      "role": "reference-materialization",
      "path": "lib/media-pipeline/knowledge-reference-materialization.mjs"
    },
    {
      "role": "effective-rights-resolver",
      "path": "lib/media-pipeline/knowledge-effective-rights.mjs"
    },
    {
      "role": "local-reference-analysis-guard",
      "path": "lib/media-pipeline/knowledge-reference-analysis-guard.mjs"
    },
    {
      "role": "reference-technique-candidate",
      "path": "lib/media-pipeline/knowledge-reference-technique-candidate.mjs"
    },
    {
      "role": "reference-technique-materialization",
      "path": "lib/media-pipeline/knowledge-reference-technique-materialization.mjs"
    },
    {
      "role": "studio-reference-runtime-gate",
      "path": "lib/media-pipeline/studio-governance.mjs"
    },
    {
      "role": "direct-provider-input-permit",
      "path": "lib/media-pipeline/direct-provider-input-permit.mjs"
    }
  ],
  "staticDependencyRules": [
    {
      "id": "raw-transport-has-no-studio-knowledge-or-html-import",
      "subjects": [
        "lib/media-pipeline/omni-video.mjs",
        "lib/media-pipeline/gemini-image.mjs"
      ],
      "forbiddenImportPatterns": [
        "(?:^|/)knowledge(?:[-/]|[.])",
        "(?:^|/)(?:renderer-html|html-motion)(?:[-/]|[.])",
        "(?:^|/)(?:motion-graphics|qa|studio-governance|studio-policies)(?:[.]mjs)?$"
      ]
    },
    {
      "id": "canonical-compiler-does-not-import-execution-adapters",
      "subjects": [
        "lib/media-pipeline/film-compiler.mjs"
      ],
      "forbiddenImportPatterns": [
        "(?:^|/)(?:omni-video|gemini-image|google-vids-voices|flow-music)(?:[.]mjs)?$",
        "(?:^|/)(?:renderer|adapters?)(?:[-/]|[.])",
        "^playwright(?:-core)?$",
        "^node:child_process$",
        "^node:sqlite$"
      ]
    },
    {
      "id": "execution-kernel-does-not-own-provider-adapters",
      "subjects": [
        "lib/media-pipeline/execution-kernel.mjs"
      ],
      "forbiddenImportPatterns": [
        "(?:^|/)(?:omni-video|gemini-image|google-vids-voices|flow-music)(?:[.]mjs)?$",
        "(?:^|/)(?:renderer-html|html-motion)(?:[-/]|[.])",
        "^playwright(?:-core)?$",
        "^node:child_process$"
      ]
    },
    {
      "id": "global-candidate-catalog-does-not-import-private-store-or-runtime",
      "subjects": [
        "lib/media-pipeline/knowledge-domain-pack-action.mjs",
        "lib/media-pipeline/knowledge-domain-pack-catalog.mjs",
        "lib/media-pipeline/knowledge-audiovisual-ontology.mjs"
      ],
      "forbiddenImportPatterns": [
        "(?:^|/)knowledge-(?:service|store|backup|asset-integrity|importers|schema-replay)(?:[.]mjs)?$",
        "(?:^|/)(?:omni-video|gemini-image|google-vids-voices|flow-music|media-tools)(?:[.]mjs)?$",
        "^node:sqlite$",
        "^node:child_process$",
        "^playwright(?:-core)?$"
      ]
    }
  ],
  "scopedDependencyRules": [
    {
      "id": "knowledge-modules-do-not-import-provider-or-media-adapters",
      "searchRoot": "lib/media-pipeline",
      "subjectPattern": "(?:^|/)knowledge-.*[.]mjs$",
      "allowNoSubjects": false,
      "forbiddenImportPatterns": [
        "(?:^|/)(?:omni-video|gemini-image|google-vids-voices|flow-music|media-tools)(?:[.]mjs)?$",
        "(?:^|/)(?:renderer|adapters?)(?:[-/]|[.])",
        "^playwright(?:-core)?$",
        "^node:child_process$"
      ]
    },
    {
      "id": "knowledge-sqlite-import-has-a-single-authorized-owner",
      "searchRoot": "lib/media-pipeline",
      "subjectPattern": "(?:^|/)knowledge-.*[.]mjs$",
      "allowNoSubjects": false,
      "allowedSubjects": [
        "lib/media-pipeline/knowledge-store.mjs"
      ],
      "forbiddenImportPatterns": [
        "^node:sqlite$"
      ]
    }
  ],
  "singletonDeclarations": [
    {
      "id": "one-canonical-compiler-export",
      "searchRoot": "lib/media-pipeline",
      "extension": ".mjs",
      "needle": "export function compileFilmSpec(",
      "owner": "lib/media-pipeline/film-compiler.mjs"
    },
    {
      "id": "one-execution-journal-schema-owner",
      "searchRoot": "lib/media-pipeline",
      "extension": ".mjs",
      "needle": "export const EXECUTION_JOURNAL_SCHEMA",
      "owner": "lib/media-pipeline/execution-journal.mjs"
    },
    {
      "id": "one-execution-authorization-schema-owner",
      "searchRoot": "lib/media-pipeline",
      "extension": ".mjs",
      "needle": "export const EXECUTION_AUTHORIZATION_SCHEMA",
      "owner": "lib/media-pipeline/execution-authorization.mjs"
    },
    {
      "id": "one-feedback-event-schema-owner",
      "searchRoot": "lib/media-pipeline",
      "extension": ".mjs",
      "needle": "export const FEEDBACK_EVENT_SCHEMA",
      "owner": "lib/media-pipeline/knowledge-feedback.mjs"
    },
    {
      "id": "one-feedback-interpretation-candidate-schema-owner",
      "searchRoot": "lib/media-pipeline",
      "extension": ".mjs",
      "needle": "export const FEEDBACK_INTERPRETATION_CANDIDATE_SCHEMA",
      "owner": "lib/media-pipeline/knowledge-feedback.mjs"
    },
    {
      "id": "one-feedback-promotion-decision-schema-owner",
      "searchRoot": "lib/media-pipeline",
      "extension": ".mjs",
      "needle": "export const FEEDBACK_PROMOTION_DECISION_SCHEMA",
      "owner": "lib/media-pipeline/knowledge-feedback.mjs"
    },
    {
      "id": "one-knowledge-action-registry-owner",
      "searchRoot": "lib",
      "extension": ".mjs",
      "needle": "export const KNOWLEDGE_ACTION_VALUES",
      "owner": "lib/knowledge-actions.mjs"
    },
    {
      "id": "one-knowledge-policy-hash-owner",
      "searchRoot": "lib/media-pipeline",
      "extension": ".mjs",
      "needle": "export const KNOWLEDGE_POLICY_HASH",
      "owner": "lib/media-pipeline/knowledge-policy-registry.mjs"
    }
  ]
}
```
<!-- architecture-fitness-manifest:end -->

## Direção permitida

```text
CLI e app
    │
    ▼
application service
    ├──────────────► Knowledge Core
    │                  │
    │                  ▼
    │          knowledge-context / decision artifacts
    │
    ▼
film-spec@2 → compiler → execution-plan@1
                               │
                               ▼
                            journal
                               │
                               ▼
                            adapters
                               │
                               ▼
                      artefatos e recibos
```

Evidência observada em recibos pode voltar como candidato ao Knowledge Core.
Esse retorno não concede a Knowledge Core autoridade de execução.

## Matriz

| ID | Invariante | Prova | Estado atual |
|---|---|---|---|
| F-001 | Owners canônicos existem | caminhos do manifesto | automatizado |
| F-002 | Transporte direto não importa Studio, Knowledge ou HTML | análise de imports | automatizado |
| F-003 | Compilador não importa adapters, renderer, processo ou SQLite | análise de imports | automatizado |
| F-004 | Existe um único export `compileFilmSpec` | declaração singleton | automatizado |
| F-005 | Existe um único owner de `execution-journal@1` | declaração singleton | automatizado |
| F-006 | `raw` consulta zero conhecimento e submete exatamente uma chamada | testes de boundary do CLI e adapter | automatizado |
| F-007 | Somente o repository abre `knowledge.sqlite` | regra de import, path policy e testes do store | automatizado |
| F-008 | Toda consulta privada exige `ScopeGrant` | testes de contrato, expiração e isolamento | automatizado na fundação |
| F-009 | Revogação bloqueia antes da análise local | duas leituras autoritativas ao redor do snapshot físico e spy do analyzer | automatizado na fundação da Fase 3 |
| F-010 | Nó pago exige dependências concluídas, attempt válido e nonce de uso único | concorrência, rollback antes do commit e replay no journal | automatizado no caminho canônico; superfícies standalone em rollout |
| F-011 | Tipo novo de nó executa pelo journal, não pelo legado | teste de contrato do Adapter SDK | gate do SDK |
| F-012 | CLI e app usam o mesmo application service | regra de imports e teste de paridade | gate da console |
| F-013 | Projeções são reconstruíveis a partir do canônico | rebuild e comparação por hash | gate por projeção |
| F-014 | Modelo não grava banco nem executa provider | dublês de repository e adapter | gate do advisor |
| F-015 | Item privado ou candidato sem envelope completo falha fechado | schemas, hashes e testes negativos de governança | automatizado na fundação |
| F-016 | Backup físico público não atravessa múltiplos roots | snapshot consistente, attestation e testes de backup/restore | automatizado; estratégia fail-closed do ADR 0004 |
| F-017 | Integridade de assets não repara nem persiste quarentena | relatório `readOnly`, `reportOnly`, `repairPerformed: false` e testes | automatizado |
| F-018 | Replay histórico preserva payload e usa readers/upcasters determinísticos | registry hasheado, release autorizada, registry builtin e testes de replay | automatizado |
| F-019 | Importador só produz candidato e nunca promove ou escreve no store | contratos candidate-only, application service read-only e testes dos cinco importadores | automatizado |
| F-020 | Quarentena e promoção exigem revisão humana explícita | decisão append-only, CAS de revisão/hash, ledger e testes de autoridade | automatizado |
| F-021 | `recordType` e schema formam contrato executável e toda referência fecha no mesmo root | registry tipado, binding transacional e casos adversariais | automatizado |
| F-022 | Ativação e rollback de release são explícitos, append-only e revalidam elegibilidade | confirmação humana, CAS da ativação, release closure e testes | automatizado |
| F-023 | Links entre Knowledge Store e mídia usam payload governado e API especializada | registro humano, raiz canônica, hash, integrity e backup v2 | automatizado |
| F-024 | Ontologia e domain packs globais permanecem `candidate` e sem autoridade de retrieval | schemas const, bloqueios de autoridade e testes adversariais | automatizado |
| F-025 | Catálogo global não carrega SQLite, store privado, provider ou runtime audiovisual | regra de imports e loader de teste que bloqueia módulos proibidos | automatizado |
| F-026 | Fonte, base epistêmica, termos, política interna e licença fecham semanticamente | allowlist, hashes, refs inbound, coerência cross-pack e casos negativos | automatizado |
| F-027 | Projeções globais são reconstruídas do canônico e neutralizam conteúdo executável | comparação integral de hash, sync exato e testes HTML/Markdown/ANSI/bidi | automatizado |
| F-028 | Disponibilidade de StyleSpec não é apresentada como validação estética | reconciliação de evidência separada do lifecycle operacional | automatizado |
| F-029 | Cohort não cresce por diretório, nome, cópia ou asset futuro | manifest, atestação e testes adversariais | automatizado na fundação da Fase 3 |
| F-030 | Materialização de um cohort não deixa itens ou eventos parciais | transação única e teste de rollback | automatizado na fundação da Fase 3 |
| F-031 | Técnica derivada só é gravada se asset e rights record ainda forem os heads exatos | `expectedHeads` verificados no mesmo `BEGIN IMMEDIATE` e testes de revogação/revisão concorrente | automatizado na fundação da Fase 3 |
| F-032 | Referência Studio nunca vira provider input por sidecar ou localização de arquivo | blocker canônico para toda `scene.references`, sidecar `report-only` e spies de adapter | automatizado na fundação da Fase 3 |
| F-033 | Input externo direto exige decisão humana presa aos bytes da invocação | permit branded, SHA-256/bytes/MIME/role/operação, conferência JIT e preflight integral do batch | automatizado no CLI da Fase 3 |
| F-034 | O app não confia em permit do browser nem encaminha input não confirmado | reconstrução local do permit e teste de zero chamadas ao proxy/provider | automatizado no app da Fase 3 |
| F-035 | Interpretação candidata fecha exatamente no feedback-fonte e não amplia escopo ou dimensões | binding de IDs/hashes, herança exata de `intendedScope`, subset de dimensões e testes adversariais | automatizado na Fase 4.2 |
| F-036 | Candidato de interpretação não é Knowledge item nem participa de release | classificação non-item no registry, readers builtin inalterados e testes de exclusão | automatizado na Fase 4.2 |
| F-037 | Replay especializado de feedback reconstrói somente um ledger íntegro e determinístico | validação da cadeia inteira, ordem por sequence, projector puro e aggregate hash | automatizado na Fase 4.2 |
| F-038 | Criar, listar ou reproduzir interpretação não promove, planeja, executa nem chama provider | autoridade fixa zero, resultado tipado, spies de side effects e testes provider-free | automatizado na Fase 4.2 |
| F-039 | Evento privado sem classificação e candidato persistido governam backup inclusive após o snapshot | piso `restricted` para feedback não classificado, floor derivado somente de evento validado, revalidação pós-snapshot, teste de TOCTOU e restore | automatizado na Fase 4.2 |
| F-040 | Snapshot de backup não pode adquirir outro root após o pré-voo | recontagem global pós-snapshot, attestation do root e teste concorrente sem bundle | automatizado na Fase 4.2 |
| F-041 | Política histórica não depende de recalcular hash de documento mutável | registry embutido de pares ID/hash, documento @1 congelado e teste de divergência | automatizado na Fase 4.2 |
| F-042 | Evento novo prova ScopeGrant canônico e não persiste autorização multi-root | migration v4, grant JSON preso ao event hash, recomposição integral, contagem legada e testes adversariais | automatizado na Fase 4.2 |
| F-043 | Fila de promoção é provider-free, pequena, explicável e determinística | fatores operacionais explícitos, snapshot `asOf/scope/limit`, ordenação lexical e `queueHash` | automatizado na Fase 4.3 |
| F-044 | Decisão humana da fila é append-only e não promove implicitamente conhecimento ativo | binding de candidato/event/queue hash, actor do ScopeGrant, decisões terminais e replay de ledger | automatizado na Fase 4.3 |
| F-045 | Snapshot temporal não pode ser contaminado por decisão posterior e terminal só pode ser substituída explicitamente | filtro de `decidedAt <= asOf`, `supersedesDecisionId` preso à terminal mais recente e teste adversarial | automatizado na Fase 4.4 |
| F-046 | `apply-once` fica restrito à produção, plano e expiração declarados sem entrar em release ou execução | `planFingerprint`/`productionId`/`expiresAt` hash-bound, validação da productionScopeId e teste provider-free | automatizado na Fase 4.4 |
| F-047 | Canonicalização humana cria regra e evidência atômicas sem ativar release ou provider | request/decision/candidate hashes, payload `preference-rule@1`, lote transacional, idempotência e teste de ausência de release | automatizado na Fase 4.5 |
| F-048 | Retrieval lexical só indexa itens da release ativa com scope, status, retenção e `textualIndexing` elegíveis | repository verifica ledger e release, projeção FTS5 efêmera e exclusões hash-bound | automatizado na Fase 5 |
| F-049 | Índice de retrieval é projeção descartável e não um segundo banco ou fonte de verdade | único owner SQLite no repository, tabela FTS5 em memória e teste de ausência de mutação | automatizado na Fase 5 |
| F-050 | Trace e contexto de retrieval são determinísticos, explicáveis e sem autoridade criativa | `retrieval-trace@1`, `knowledge-context@1`, hashes, rationale e `authority/plannerInfluence=none` | automatizado na Fase 5 |
| F-051 | Conflitos usam comparadores tipados e precedência de scope explícita | `typed-json@1`, `scope-specificity@1`, casos compatible/override/unresolved | automatizado na Fase 5 |
| F-052 | Ação `retrieval-shadow` é read-only, provider-free e não altera plano, release ou output | application service único, `changed=false`, spies e contrato de ação | automatizado na Fase 5 |
| F-053 | Brief e contexto Studio são contratos hash-bound, sem autoridade ou planner influence | `studio-brief@1`, snapshot `knowledge-context@1`, binding canônico e testes de adulteração | automatizado na Fase 6 |
| F-054 | O mesmo brief, contexto, compiler e decision boundary produzem o mesmo execution-plan | campos congelados no `film-spec@2`, binding no `execution-plan@1`, fingerprint e teste determinístico | automatizado na Fase 6 |
| F-055 | `run`/`resume` não refazem retrieval nem alteram o contexto criativo congelado | plano e estado carregam binding; receipts carregam somente hashes e runtime guard permanece separado | automatizado na Fase 6 |
| F-056 | Recipes e receipts carregam apenas a projeção mínima de contexto, sem payload privado | `briefHash`/`knowledgeContextHash` e binding sem `appliedItems` ou texto privado | automatizado na Fase 6 |
| F-057 | Replay do journal é estável e read-only | `execution-replay@1`, projection sem path/IDs/relógio e hash determinístico | automatizado na Fase 6A |
| F-058 | Ponte `film-state@1` preserva estado, handles e referências sem mutação | migração idempotente, `legacy_node_migrated`, comparação ampliada e reconciliação report-only | automatizado na Fase 6A |
| F-059 | Tipo de nó novo não pode usar executor legado | allowlist de kinds e falha fechada de compatibilidade | automatizado na Fase 6A |
| F-060 | Rollback do rollout não reescreve receipts, outputs ou handles | decisão explícita, fingerprint e `mutationPerformed=false` | automatizado na Fase 6A |
| F-061 | `timeline@2` evolui `timeline@1` sem segunda fonte de tempo | adapters puros, ranges racionais e round-trip por fingerprint | automatizado na Fase 7 shadow |
| F-062 | Motion IR preserva tracks/layers/clips e não carrega paths ou sessão | `motion-ir@1`, seed explícito, determinismo declarado e validator fechado | automatizado na Fase 7 shadow |
| F-063 | Range aberto não inventa duração ou fim | `startFrame` opcionalmente conhecido, `durationFrames/endFrameExclusive` coerentes | automatizado na Fase 7 shadow |
| F-064 | Renderer futuro só roda com sandbox offline pinado | `renderer-sandbox@1`, hashes de browser/Node/FFmpeg/fontes e relógio por frame | automatizado na Fase 7 contract |
| F-065 | Bake-off não promove renderer automaticamente | `renderer-bake-off@1`, decisão `pending` e `promotionPerformed=false` | automatizado na Fase 7 contract |
| F-066 | Raw e execution-plan permanecem intocados pela timeline shadow | módulos isolados, sem imports de provider, browser ou SQLite | automatizado na Fase 7 shadow |
| F-067 | Composição híbrida só existe no Studio e usa uma única track base | `hybrid-composition@1`, `requireStudioMode` e exatamente uma `video-base` | automatizado na Fase 8 shadow |
| F-068 | Overlays alpha são tipados, temporais e não alteram o original | `video-alpha`, intervalo fechado por frames, posição numérica e publicação atômica | automatizado na Fase 8 shadow |
| F-069 | Cache de composição é content-addressed e não fonte de verdade | plano hash-bound por manifest, artefatos e toolchain; sem reuse implícito | automatizado na Fase 8 shadow |
| F-070 | Áudio e captions entram por tracks explícitas e preservam o áudio base por padrão | modos `preserve-base`, `replace-base`, `mix` e captions locais declaradas | automatizado na Fase 8 shadow |
| F-071 | Master híbrido encadeia receipts e nunca move ou sobrescreve assets | artefatos hash-atestados, parent receipts e `atomic-temp-no-overwrite` | automatizado na Fase 8 shadow |
| F-072 | Adapters compartilham uma interface sem duplicar o registry ou executor | `adapter-contract@1`, operations, auth contract e capability source única | automatizado na Fase 9 shadow |
| F-073 | Capability indisponível bloqueia antes de qualquer execução | `adapter-invocation@1` com preflight e blockers hash-bound | automatizado na Fase 9 shadow |
| F-074 | Operação paga exige autorização JIT explícita | `authorizationRequired`, callback de runtime e ausência de chamada sem autorização | automatizado na Fase 9 shadow |
| F-075 | Resultado é normalizado sem retry implícito | `adapter-result@1`, estados ready/pending/ambiguous/failed e nextAction | automatizado na Fase 9 shadow |
| F-076 | Reconcile não possui caminho de geração | método reconcile isolado e conformance double provider-free | automatizado na Fase 9 shadow |
| F-077 | Creative Console é uma projeção read-only, não uma fonte de verdade | `creative-console-snapshot@1`, fingerprint e `changed=false` | automatizado na Fase 10 |
| F-078 | Inspector não expõe prompt, path, statement privado ou payload de provider | sumarização por IDs, hashes, contagens e capabilities permitidas | automatizado na Fase 10 |
| F-079 | App e CORE usam o mesmo serviço de snapshot | rota única `/api/creative-console/inspect` sem lógica paralela | automatizado na Fase 10 |
| F-080 | Trace e plan inspector não executam, aprovam ou promovem | ações fixas `false`, `providerCalls=0` e revisão humana obrigatória | automatizado na Fase 10 |
| F-081 | Timeline preview é somente projeção frame/track e não renderiza | `timeline-preview@1`, source fingerprint e `effect=none` | automatizado na Fase 10 |
| F-082 | Preview preserva ranges abertos e não expõe sources físicos | segundos nulos para fim desconhecido, IDs sem path/segredo e teste adversarial | automatizado na Fase 10 |
| F-083 | Fila de feedback no Console é projeção read-only e não altera decisões | `present/pendingIds/summary` sanitizados, sem texto original, e ações de promoção permanecem falsas | automatizado na Fase 10 |
| F-084 | Resolver filtra admissibilidade antes de ranquear preferência | opções bloqueadas não entram no ranking e status `no-admissible-option` falha fechado | automatizado na Fase 5 shadow |
| F-085 | Precedência de preferência é determinística e separada de viabilidade | autoridade, scope, supersessão, revisão e evidência ordenam sem média ou modelo | automatizado na Fase 5 shadow |
| F-086 | Indisponibilidade não rebaixa silenciosamente pedido explícito | opção preferida inviável produz `blocked-viability`, alternativas visíveis e `requiresReplan` | automatizado na Fase 5 shadow |
| F-087 | Conflito comparável exige decisão humana | mesmo `conflictSet`, autoridade e scope com valores diferentes não seleciona vencedor | automatizado na Fase 5 shadow |
| F-088 | `decision-shadow` é a única superfície CLI do resolver e não abre o store | `knowledge --action decision-shadow`, input privado validado, ação `changed=false` e `planInfluence=none` | automatizado na Fase 5 shadow |
| F-089 | Decision artifacts só entram no Studio com confirmação humana e contexto exato | `studio-decision-artifacts@1`, refs hash-bound e `film-spec@2` rejeita contexto divergente | automatizado na Fase 6 |
| F-090 | O compilador transporta somente a projeção hash-bound da decisão | `execution-plan@1` repete fingerprint; texto/rationale não é anexado a receipts | automatizado na Fase 6 |
| F-091 | Todo execution plan atual identifica a versão do compilador | `compilerVersion` semver-like é obrigatório na integridade canônica e entra no fingerprint | automatizado na Fase 6 |
| F-092 | Capability snapshot do plano é explícito e hash-bound | `capabilitySnapshotHash` é derivado da projeção de capabilities e comparado no integrity guard | automatizado na Fase 6 |
| F-093 | Captura de feedback pelo app atravessa o serviço Knowledge e exige configuração + confirmação humana | rota `/api/creative-console/feedback/capture`, DB/root configurados, `confirmHuman=true`, input governado e nenhum provider | automatizado na Fase 10 |
| F-094 | Avaliação shadow no Creative Console é relatório, não autoridade | somente métricas/hash de `retrieval-shadow-evaluation@1`, casos privados omitidos, `changed=false` e `providerCalls=0` | automatizado na Fase 10 |
| F-095 | Preference ranker em shadow reutiliza o resolver e não ganha autoridade | request/resolution com fingerprint idêntico, precedência determinística, `authority=none`, `plannerInfluence=none`, `changed=false` e `providerCalls=0` | automatizado na Fase 10 |
| F-096 | Release governance no Console só projeta `active-release` read-only | lifecycle provider-free, `readOnly=true`, `changed=false`, ativação/rollback rejeitados e somente release/hash/elegibilidade/issues tipados | automatizado na Fase 10 |
| F-097 | Editor de feedback só captura target com artifact e receipt verificados | refs item/revision/contentHash iguais a vínculos `resolved`, A/B verificado quando presente e rota sem targetVerification falha fechado | automatizado na Fase 10 |
| F-098 | Piloto híbrido só fica pronto com seleção humana e assets hash/receipt resolvidos | `hybrid-pilot-selection@1`, direitos `allowed`, base Omni/aprovado, overlay local/determinístico, dois artifacts/receipts distintos e readiness sem provider | automatizado na Fase 8 |
| F-099 | Readiness pronta só materializa o manifesto canônico Studio | selection/readiness fingerprints iguais, `ready=true`, `hybrid-composition@1` existente, sem execução ou segundo compositor | automatizado na Fase 8 |
| F-100 | Console explica decisão shadow sem carregar valores privados ou autoridade | `preference-ranker-shadow@1` validado, IDs/estado/fingerprint projetados, valores omitidos e ações continuam read-only | automatizado na Fase 10 |

“Gate futuro” não significa exceção aceita. Significa que a prova depende de uma
interface concreta que ainda não existe. A feature correspondente não pode ser
promovida sem transformar o gate em teste executável.

## Limites por domínio

### Raw

Pode depender de:

- validação de entrada;
- transporte autorizado;
- artifact;
- receipt;
- sanitização;
- integridade técnica;
- reconciliação do mesmo POST.

Não pode depender de:

- Knowledge Core;
- retrieval;
- preferências;
- StyleSpec;
- HTML;
- motion;
- mix;
- captions;
- QA semântico;
- seleção ou correção automática.

Os módulos listados no manifesto são o núcleo de transporte atual. A prova
comportamental complementar observa carregamentos dinâmicos e confirma que
`raw` não consulta a configuração do Knowledge Core e mantém a submissão
gerativa única prevista pelo contrato.

### Studio

Pode orquestrar:

- contexto de conhecimento congelado;
- decisão criativa materializada;
- compilação canônica;
- journal;
- adapters;
- HTML local;
- pós-produção;
- QA explicitamente configurado.

Não pode:

- alterar o plano durante `run` ou `resume`;
- promover conhecimento;
- conceder direitos;
- repetir estado ambíguo;
- gastar a partir de feedback ou QA.

### Knowledge Core

Pode:

- persistir eventos, revisões e payloads tipados;
- resolver e isolar acesso por `ScopeGrant`;
- validar owners e referências no mesmo root;
- registrar links governados de mídia;
- propor candidatos read-only;
- registrar promoção e quarentena por decisão humana;
- criar, ativar e reverter releases;
- criar e restaurar snapshots provider-free dentro do contrato single-root
  fail-closed;
- verificar vínculos de assets em modo read-only e report-only;
- reproduzir release autorizada com readers e upcasters históricos;
- importar fontes conhecidas somente como candidatos sanitizados;
- exportar payload histórico desconhecido sem torná-lo elegível para release
  nova;
- inspecionar ontologia e packs globais candidatos sem persistir no store
  privado nem conceder autoridade.

Não pode:

- importar ou executar adapters;
- abrir mídia para geração;
- alterar film state;
- consumir nonce pago;
- promover inferência autonomamente.
- fazer backup físico público de store com múltiplos roots;
- reparar, substituir, mover, apagar ou colocar asset em quarentena durante
  verificação;
- reescrever payload histórico durante replay;
- transformar candidato de importação em item ativo sem decisão humana.

O `knowledge-service` expõe hoje `status`, `init`, `integrity`, `export`,
`backup`, `restore`, consulta e lifecycle de releases, revisão humana,
`register-asset-link`, `import-candidate`, `replay-release`,
`capture-feedback`, `list-feedback`, `replay-feedback`,
`create-feedback-interpretation-candidate`,
`list-feedback-interpretation-candidates` e
`replay-feedback-interpretation-candidates`,
`list-feedback-promotion-queue` e
`review-feedback-interpretation` pela família única do CLI.
Importação continua candidate-only; feedback e sua interpretação
manual/local são eventos append-only separados. O candidato permanece
`pending-human-review`, traz envelope governado e autoridade fixa zero para
planejamento, retrieval, release, promoção e execução. Replay público de
release continua limitado ao registry builtin; replay de feedback é uma
projeção especializada do ledger e integrity continua report-only. Nenhuma
dessas superfícies amplia root, repara mídia ou adquire autoridade de execução.

A ação pública `knowledge --action packs` é despachada antes do runtime privado
e carrega somente catálogo global e registry de schemas. Ontologia e packs
continuam `candidate`; nenhum deles participa de retrieval ou planejamento.

A fundação governada de referências e estudo candidato pertence à Fase 3; a
captura e o replay de feedback granular foram materializados na Fase 4.1. A
Fase 4.2 materializa somente a interpretação candidata manual/local, presa por
IDs e hashes ao feedback-fonte e ao escopo pretendido original. A Fase 4.3
materializa a fila provider-free e decisões humanas hash-bound; a Fase 4.4
adiciona snapshots temporais, supersessão explícita e seleção `apply-once`,
sempre sem item ativo, retrieval ou plano. A Fase 4.5 canonicaliza `promote`
em `preference-rule@1` e evidência atômicas, sem ativar release, retrieval ou
plano.
Na Fase 5, `retrieval-shadow` reconstrói FTS5 efêmero somente no repository,
produz trace/contexto read-only com autoridade zero e não altera o compilador.
Integração canônica com `film-spec@2` permanece na Fase 6.

### Compilador

Pode consumir somente dados já materializados e validados. Não possui:

- rede;
- relógio como entrada implícita;
- aleatoriedade;
- SQLite;
- provider;
- renderer;
- segredo.

### Runtime guard

Pode consultar apenas heads de rights/revocation, capability e autorização
necessários ao nó atual. Não executa retrieval criativo nem degrada o plano.

## Como executar

Em `CORE/`:

```powershell
node --test test/architecture-fitness.test.mjs
```

O teste usa somente módulos nativos do Node, lê o manifesto acima e não chama
provider, sessão, browser ou rede.

## Processo de mudança

1. Identificar a regra afetada.
2. Criar ou atualizar um ADR.
3. Atualizar o manifesto.
4. Atualizar a prova executável na mesma mudança.
5. Demonstrar o teste falhando contra a violação e passando após a correção.
6. Registrar migração e rollback quando houver estado persistido.

Não se remove uma regra apenas para acomodar uma implementação. Uma exceção
precisa ter escopo, prazo, owner e ADR explícitos.
