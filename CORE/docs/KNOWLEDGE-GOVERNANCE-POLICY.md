# Política de governança do Knowledge Core

- Status: ativa para a implementação provider-free
- Versão: `knowledge-governance-policy@1`
- Data: 2026-07-23
- Autoridade: `AGENTS.md` continua prevalecendo
- Escopo: `CORE/knowledge/`, `knowledge.sqlite`, índices, backups, exports,
  feedback e contextos derivados

## 1. Objetivo

Esta política permite que o Studio guarde conhecimento técnico, operacional e
privado sem transformar prompts, referências ou opiniões em uma memória opaca.

Ela preserva:

- isolamento entre clientes;
- direitos e consentimento;
- histórico append-only;
- promoção humana;
- reprodutibilidade;
- exportação e revogação;
- `raw` sem Knowledge Core;
- zero gasto causado por aprendizagem.

## 2. Autoridades

Ordem de autoridade:

1. `AGENTS.md`;
2. direitos, consentimentos e revogações ativos;
3. esta política;
4. ADRs aceitos;
5. schemas e migrations;
6. releases de conhecimento;
7. projeções, índices e relatórios.

FTS, embeddings, Markdown e cache são projeções. Nunca prevalecem sobre o ledger
ou sobre uma decisão de direitos atual.

## 3. Classes de dados

### 3.1 Técnico público

Exemplos:

- ontologia;
- schemas;
- knowledge packs com fontes e licença;
- fixtures sintéticas;
- ADRs;
- evals sem dados privados.

Armazenamento:

- Git permitido.

### 3.2 Operacional interno

Exemplos:

- capability snapshots sanitizados;
- fingerprints;
- métricas sem conteúdo privado;
- manifests;
- IDs pseudônimos;
- relatórios de integridade.

Armazenamento:

- Git somente quando estável, sanitizado e intencional;
- caso contrário, diretório local de diagnósticos.

### 3.3 Confidencial de cliente

Exemplos:

- briefs;
- brand kits privados;
- projetos;
- decisões;
- feedback;
- assertions;
- documentos;
- relações.

Armazenamento:

- `knowledge.sqlite` fora do Git;
- exige `root_scope_id`;
- nunca entra em fixture real.

### 3.4 Pessoal ou sensível

Exemplos:

- identidade;
- consentimento;
- restrições de representação;
- voz;
- imagem oficial;
- informação pessoal em feedback ou brief.

Armazenamento:

- metadata mínima no banco privado;
- binários permanecem no local canônico;
- acesso sempre scoped;
- export e revogação próprios.

### 3.5 Segredo

Exemplos:

- cookies;
- tokens;
- headers de sessão;
- senhas;
- API keys;
- HAR;
- credenciais.

Armazenamento:

- proibido no Knowledge Core, ledger, receipt, export, prompt e log;
- somente cofres e perfis definidos em `AGENTS.md`.

## 4. Escopo e isolamento

Todo dado privado possui:

- `scope_id`;
- `root_scope_id` imutável;
- classificação;
- owner;
- status;
- timestamps;
- proveniência.

Classificações canônicas:

- `public`: conteúdo legitimamente público, ainda sujeito a proveniência e
  direitos;
- `internal`: uso operacional interno;
- `confidential`: conteúdo de cliente, projeto ou relação comercial com acesso
  restrito;
- `restricted`: dado pessoal sensível, segredo comercial ou material sujeito a
  controle reforçado.

Classificação não concede direito de uso. Um backup do store nunca pode ser
classificado como `public`, mesmo quando contenha somente registros públicos.

Regras:

- um repository único abre `knowledge.sqlite`;
- toda operação privada recebe `ScopeGrant`;
- grant sem o root solicitado falha;
- relações cross-root falham por padrão;
- FTS, embedding, cache e export preservam o root;
- export privado é gravado fora do workspace e do Git;
- IDs em receipts são pseudônimos ou hashes;
- nenhum texto privado de cliente entra em receipt operacional;
- conhecimento privado não é promovido globalmente sem abstração, anonimização
  e aprovação humana.

Gate da fundação:

- enquanto classificação, owner, proveniência, rights e validação unificada não
  forem campos obrigatórios do envelope, as APIs de escrita do repository são
  internas e só podem receber fixtures sintéticas;
- a superfície operacional pública permanece limitada a inicialização,
  status, integrity e export de dados já governados;
- ingestão produtiva de cliente, pessoa, projeto, feedback ou referência fica
  bloqueada até esse gate virar contrato e teste.

## 5. `ScopeGrant`

Um grant é uma decisão auditável, não um segredo.

Campos mínimos:

- schema e versão;
- actor;
- roots permitidos;
- operações permitidas;
- finalidade;
- emissão;
- expiração opcional;
- ID;
- ID e hash da política aplicada;
- hash canônico do grant.

Princípio de menor privilégio:

- leitura não implica escrita;
- export não implica promoção;
- administração global não é default;
- um grant nunca concede direitos sobre assets;
- o repository valida o grant a cada operação.

## 6. Proveniência e modalidade

Cada item de conhecimento declara:

- origem;
- modalidade;
- status;
- evidência;
- scope;
- revisão;
- hash.

Modalidades:

- `fact`;
- `capability`;
- `hard-constraint`;
- `preference`;
- `heuristic`;
- `observation`;
- `hypothesis`;
- `anti-pattern`.

Confiança não muda modalidade. Proveniência conhecida não concede direito.

## 7. Direitos

Cada asset possui decisões independentes para:

- inventário técnico;
- análise local;
- indexação textual;
- embedding;
- treinamento;
- input de provedor;
- publicação;
- reutilização.

Estados:

- `allowed`;
- `denied`;
- `unknown`;
- `revoked`;
- `expired`.

`unknown`, `denied`, `revoked` e `expired` falham fechados para qualquer uso que
não seja inventário técnico mínimo legitimamente acessível.

Regras:

- receipt prova linhagem, não licença completa;
- asset oficial prova fonte, não consentimento universal;
- atestação em lote lista hashes exatos;
- diretório, nome ou semelhança não concedem permissão;
- revogação atualiza o head usado pelo runtime guard;
- histórico de uso anterior não é apagado.

## 8. Feedback e aprendizagem

O texto humano original é append-only.

Interpretação por modelo:

- é candidata;
- possui origem e hash;
- não substitui o texto;
- não promove;
- não executa;
- não consome cota automaticamente.

Estados:

```text
captured
→ interpreted
→ confirmed
→ applied
→ observed
→ promoted | rejected | superseded
```

Uma decisão “somente nesta peça”:

- exige ação humana;
- entra no fingerprint da peça;
- não ativa o candidato;
- não entra em release futura.

## 9. Retenção

Nenhum prazo comercial é presumido.

Cada root privado declara uma política:

- `manual-review`;
- `until-project-close`;
- `until-rights-expire`;
- data explícita;
- obrigação contratual documentada.

Até existir decisão:

- o default é `manual-review`;
- não há deleção automática;
- expiração produz candidato report-only;
- cache e projeções podem ser reconstruídos e removidos sem apagar a fonte;
- ledger mínimo e receipts são preservados conforme a obrigação aplicável.

## 10. Exportação, revogação e esquecimento

Export:

- exige `ScopeGrant`;
- seleciona root exato;
- é determinístico;
- inclui manifest, schemas, hashes e sequence;
- não inclui segredos;
- não inclui outro root.

Revogação:

- é append-only;
- invalida projeções e elegibilidade;
- bloqueia nós ainda não iniciados;
- não reescreve receipt histórico.

Esquecimento:

- remove ou anonimiza conteúdo quando legalmente permitido;
- preserva somente o ledger mínimo necessário;
- registra quais projeções foram invalidadas;
- exige ação explícita;
- nunca é disparado por QA, feedback ou modelo.

## 11. Backup e restore

Cada backup inclui:

- snapshot consistente do banco;
- sequence do ledger;
- schema version;
- release ativa;
- manifest de assets por hash;
- classificação;
- timestamp;
- checksum.

Autorização:

- snapshot SQLite contém o store inteiro e, por isso, não herda autorização de
  um root isolado;
- enquanto não existir grant administrativo ou cobertura verificável de todos
  os roots, a operação pública aceita somente store vazio ou store com um único
  root explicitamente atestado;
- store com múltiplos roots falha fechado, sem criar snapshot parcial ou
  reutilizar um grant de cliente como autoridade global;
- classificação do bundle é sempre `internal`, `confidential` ou `restricted`;
  `public` é proibido para backup do store.

Restore:

- roda integrity check;
- compara assets por hash;
- detecta restore assimétrico;
- reporta vínculos pendurados;
- não move, substitui ou apaga assets;
- exige ação humana para quarentena persistente ou reparo.

## 12. Runtime guard

O contexto criativo fica congelado. Antes de usar um asset ou provider, o
Execution Kernel revalida somente:

- head de rights/revocation;
- consentimento;
- capability snapshot e TTL;
- autorização de execução, quando aplicável.

O guard:

- é read-only em relação ao conhecimento criativo;
- não faz retrieval;
- não recompõe prompt;
- não escolhe fallback;
- falha antes do uso;
- registra diagnóstico sanitizado;
- não autoriza retry.

## 13. Modelo de ameaça

| Ameaça | Controle obrigatório |
|---|---|
| Vazamento entre clientes | `root_scope_id`, `ScopeGrant`, repository único |
| SQL sem scope | proibição de acesso direto e fitness test |
| Prompt injection | dados delimitados; política fora do conteúdo |
| Referência sem direito | rights fail-closed |
| Revogação após plano | runtime guard |
| Segredo em banco/log | denylist, sanitização e testes |
| Modelo promovendo regra | candidate + aprovação humana |
| Feedback gerando gasto | separação entre memória e executor |
| Restore assimétrico | manifest e integrity report |
| Asset homônimo substituído | resolução por hash |
| HTML hostil | sandbox sem rede/cookies/filesystem livre |
| Capability stale | TTL e snapshot |
| Estado ambíguo repetido | journal + reconcile, sem retry |
| Schema novo quebrando release | payload histórico + reader/upcaster testado |

## 14. Fitness mínimo

Testes provider-free devem provar:

- `raw` não consulta conhecimento;
- `raw` não importa renderer Studio em seu caminho operacional;
- somente o repository abre `knowledge.sqlite`;
- operação privada sem grant falha;
- grant de outro root falha;
- relação cross-root falha;
- export não mistura roots;
- revogação invalida elegibilidade;
- schema anterior continua legível;
- nenhum adapter pago executa sem autorização;
- nenhum check de integridade corrige automaticamente.

## 15. Mudança desta política

Alterações exigem:

- diff explícito;
- justificativa;
- impacto sobre dados existentes;
- migration ou compatibilidade;
- testes;
- rollback;
- atualização de `AGENTS.md` quando houver mudança de autoridade.
