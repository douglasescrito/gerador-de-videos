# ADR 0012 — candidato de interpretação de feedback

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Status: aceito
- Data: 2026-07-27
- Fase: 4.2

## Contexto

A Fase 4.1 preservou a opinião humana como `feedback-event@1` imutável,
ligado a produção, artefato, receipt, markers, dimensões, comparação A/B e
escopo pretendido. O próximo passo do ciclo de aprendizagem é separar essa
opinião de uma interpretação estruturada, sem transformar nenhum dos dois em
regra ativa.

Persistir a interpretação diretamente como `knowledge_item`, membro de release
ou contexto de planejamento concederia autoridade editorial antes da revisão
humana. Criar uma tabela, banco, CLI ou replay paralelo também violaria a
espinha única do projeto.

A auditoria da Fase 4.1 encontrou ainda um requisito anterior: listagem e replay
projetavam o payload correto, mas precisavam verificar criptograficamente todo
o ledger antes de confiar em um evento-fonte.

## Decisão

Uma interpretação manual/local pode ser registrada como
`feedback-interpretation-candidate@1` em um novo evento
`feedback.interpretation-candidate.created` da tabela append-only
`knowledge_events`.

Ela usa a família existente `knowledge`:

- `create-feedback-interpretation-candidate`;
- `list-feedback-interpretation-candidates`;
- `replay-feedback-interpretation-candidates`.

Não existe novo comando principal, tabela, banco, repository, planner, executor
ou servidor.

## Binding da fonte

O candidato prende a identidade completa do feedback-fonte:

- `rootScopeId`;
- `eventId`;
- `sequence`;
- `subjectId`;
- `feedbackHash`;
- `originalTextSha256`;
- `eventHash`.

Artifact, receipt, versões e content hashes continuam pertencendo ao
`feedback-event@1`; não são repetidos livremente pelo candidato. O repository
recarrega o evento-fonte no mesmo snapshot, projeta o feedback e compara todos
os bindings antes do append.

Até existir uma decisão explícita de supersessão, cada feedback aceita no
máximo um candidato. O subject ID do candidato deriva do hash do
feedback-fonte, e a verificação de duplicidade ocorre na mesma transação do
append.

## Escopo e governança

Nesta fatia, `suggestedScope` deve ser idêntico a `intendedScope` do feedback.
Não há ampliação, correção ou promoção de escopo implícita.

O candidato contém `knowledge-record-envelope@1`:

- classificação privada;
- owner igual ao scope governado;
- proveniência exata no evento de feedback;
- modalidade `hypothesis`;
- retenção `manual-review`;
- inventário e análise local permitidos;
- indexação, embedding, training, provider input, publicação e reuse negados.

O envelope, o evento e a operação são revalidados pelo repository com
`ScopeGrant` vigente do mesmo root. O arquivo de input privado permanece fora
do workspace.

A classificação do candidato integra o piso do store somente depois que o
evento, o envelope e o binding da fonte passam pela validação semântica. O
feedback-fonte, que ainda não possui classificação própria, impõe piso
conservador `restricted`. Backup revalida o piso no pré-voo e novamente no
snapshot consistente; uma elevação concorrente aborta o bundle antes do
manifest. Restore recalcula o mesmo piso e preserva o ledger original.

## Autoridade

O contrato fixa:

- `status: candidate`;
- `stage: interpreted`;
- `review.status: pending-human-review`;
- `providerFree: true`;
- planejamento: `false`;
- retrieval: `false`;
- release: `false`;
- promoção: `false`;
- execução: `false`.

`--confirm-human true` autoriza somente o registro do candidato. Não confirma a
interpretação como conhecimento, não ativa regra e não equivale a promoção.
`interpretation.author` registra a autoria declarada do conteúdo; `eventActor`
e `scopeGrantId` na projeção registram separadamente quem realizou o append e
qual grant o autorizou. Esta fatia não transforma a confirmação booleana em
prova de identidade do autor, portanto uma promoção futura deverá exigir
atestação humana separada e autenticada.

O schema é registrado explicitamente como contrato não persistível de item.
Ele não recebe reader de release nem entra no registry de replay de releases.
Uma promoção futura deverá materializar outro contrato — previsto:
`preference-rule@1` — por decisão humana separada.

## Integridade e replay

Antes de listar, reproduzir ou anexar feedback/interpretação, o repository lê
todos os eventos do root em ordem e verifica:

- hash canônico do payload;
- elo `previousEventHash`;
- `eventHash`;
- identidade e janela do ScopeGrant;
- hash da política;
- actor e permissão.

O replay de candidatos é uma projeção especializada, read-only e
determinística do ledger. Ele pode reconstruir história mesmo quando um asset
deixou de ser o head atual, mas exige que o feedback-fonte original continue
íntegro.

O novo tipo de evento participa do projector de integrity; não pode aparecer
como `event-orphan`.

## Fora de escopo

Esta decisão não implementa:

- interpretação automática de texto;
- provider, modelo, embedding ou FTS;
- promotion queue ou ranker;
- decisão, rejeição ou supersessão;
- one-shot anexado ao plano;
- `preference-rule@1`;
- retrieval ou `knowledge-context@1`;
- alteração de `raw`, prompt, plano, output ou mídia.

## Consequências

O projeto passa a representar separadamente opinião e hipótese interpretada,
com rastreabilidade e isolamento suficientes para revisão futura. O custo é um
input tipado mais rigoroso e a impossibilidade deliberada de substituir um
candidato até que o próximo portão defina decisões e supersessão.

Nenhuma chamada de provider, sessão, geração, edição, QA ou gasto é autorizada
por esta ADR.
