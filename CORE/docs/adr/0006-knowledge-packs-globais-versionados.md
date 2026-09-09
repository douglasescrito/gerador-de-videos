# ADR 0006 — Knowledge packs globais versionados

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita
- Estado da implementação: fundação candidata implementada e provider-free
- Data: 2026-07-24
- Escopo: fundamentos técnicos públicos em `CORE/knowledge/`

## Contexto

O Knowledge Store privado da Fase 1 resolve memória mutável, escopo de cliente,
evidência e lifecycle humano. Fundamentos técnicos de motion, publicidade,
documentário, curta, som, marca e render híbrido têm outra natureza: devem ser
revisáveis no Git, citáveis e iguais para todos os clientes, sem serem copiados
para cada `knowledge.sqlite`.

Misturar essas classes criaria dois problemas:

1. conteúdo técnico público herdaria autoridade e classificação de um banco
   privado;
2. editar um documento Markdown livre poderia mudar silenciosamente o
   conhecimento consumível.

Também não é aceitável transformar livros, páginas ou referências de criadores
em corpus de imitação. Fonte bibliográfica, licença da fonte e licença do pack
são decisões distintas.

## Decisão

Os fundamentos globais vivem como arquivos de dados `domain-pack@1` em um único
diretório governado sob `CORE/knowledge/domain-packs/`.

Cada pack declara, no mínimo:

- identidade e versão editorial;
- lifecycle e revisão humana;
- domínio, escopo global e cobertura;
- autores e revisores por identidade editorial não secreta;
- fontes com origem, versão/data de acesso e modo de uso permitido;
- natureza da fonte (`standard`, draft, guidance, bibliografia, lei, regulação,
  autorregulação ou política interna);
- licença do próprio pack separada dos termos de cada fonte;
- definições, princípios, limites, riscos, exemplos abstratos,
  contraexemplos, anti-padrões e testes;
- dependências exatas;
- data de revisão e changelog.

Definições e princípios declaram se a base é `source-grounded`,
`editorial-synthesis` ou `internal-policy`. Princípios ligam técnica, intenção,
condições de uso, limites, riscos e sinais de sucesso. Toda afirmação que
dependa de fonte declara seus `sourceIds`.
Exemplos são abstratos e originais; nomes, handles ou fórmulas reconhecíveis de
criadores não se tornam direção estética.

## Lifecycle e autoridade

Validade estrutural não equivale a aprovação editorial.

- um pack `domain-pack@1` nasce e permanece `candidate`; o próprio arquivo não
  pode autodeclarar aprovação;
- somente uma atestação humana explícita, externa ao payload e presa ao hash,
  poderá promovê-lo ao estado editorial aprovado;
- loader, teste ou gerador de documentação nunca promove;
- pack candidato pode ser inspecionado e revisado, mas não influencia retrieval
  ou planejamento;
- Fase 2 não autoriza retrieval nem integração ao compilador.

Uma revisão produz nova versão e changelog. Arquivos anteriores não são
reescritos para fingir que sempre tiveram o conteúdo atual.

Enquanto o portão de retrieval não existir, nenhuma atestação de aprovação é
aceita e todo pack permanece candidato. O contrato futuro deverá usar uma cadeia
append-only assinada, com decisão, identidade do revisor, policy hash, hash
exato do pack, cabeça esperada e verificação de chave pública/revogação. Um
sidecar sem assinatura seria apenas outra autoafirmação e não é suficiente.

## Loader e manifest

O loader é provider-free, read-only e determinístico:

- lê somente o diretório canônico;
- não segue symlink, junction ou hardlink;
- rejeita path escape, arquivo desconhecido, duplicata e tamanho excessivo;
- rejeita chave JSON duplicada, nesting excessivo, controles ANSI/bidi e URI
  HTTPS com credenciais;
- valida schema fechado;
- calcula hashes sobre JSON canônico;
- exige referência inbound para toda fonte e coerência de identidade quando o
  mesmo source ID reaparece em outro pack;
- resolve somente URNs internas em allowlist e confere o hash do arquivo de
  política efetivo;
- resolve dependências exatas;
- rejeita dependência ausente, hash divergente ou ciclo;
- produz manifest e projeções ordenados e reconstruíveis.

O manifest não é uma segunda fonte de verdade. Markdown, índices e relatórios
são projeções geradas dos packs validados. O renderer reconstrói o manifest
esperado a partir dos payloads, neutraliza HTML/Markdown/controles de terminal e
falha se identidade, ordem, cobertura, dependência ou hash divergirem.

## Isolamento

`domain-pack@1` não é payload persistível do Knowledge Store privado:

- não abre SQLite;
- a ação pública `knowledge --action packs` não carrega `node:sqlite`, o
  Knowledge Store privado nem o runtime audiovisual;
- não recebe `ScopeGrant`;
- não contém dados de cliente, pessoa, projeto, prompt, feedback ou receipt
  privado;
- não é promovido por `review-item`;
- não atravessa roots porque não representa contexto privado.

Uma futura recuperação poderá combinar uma release global de packs aprovada
com uma release privada, mas deverá registrar ambos os hashes e preservar a
precedência de direitos, consentimento e hard constraints.

## Fontes e licenças

Referenciar ou parafrasear uma fonte não concede licença sobre seu conteúdo.
Por isso:

- o pack guarda apenas síntese técnica original e citações curtas quando
  estritamente necessárias;
- termos desconhecidos não são rotulados como licença aberta;
- `usageMode` informa se a fonte serve apenas para citação/paráfrase,
  extração factual ou referência bibliográfica;
- combinações de `sourceTerms` são fechadas: `known`/`public-domain` exigem
  identificador e URI; `unknown` não pode alegar licença;
- a licença do pack não amplia direitos sobre a fonte;
- mudanças relevantes de fonte exigem revisão editorial e nova versão.

O conteúdo original dos packs usa o contrato proprietário interno
[`DOMAIN-PACK-TERMS.md`](../../knowledge/DOMAIN-PACK-TERMS.md), preso ao hash
de seus bytes. O contrato permite auditoria local e, somente após aprovação
humana externa ao payload, uso interno no planejamento; não concede
redistribuição, treinamento, cópia das fontes nem envio a provider. Arquivos
hasheados têm EOL LF fixado em `.gitattributes`.

`domain-pack@1` não autoriza `licensed-reuse` nem `public-domain-reuse`. Esses
modos exigiriam prova de licença/termos e decisão humana separada; uma URL ou
um campo autodeclarado não bastam.

Pelo mesmo motivo, `packLicense.type` em `domain-pack@1` aceita somente o
contrato proprietário interno atestado. Expressões SPDX ficam reservadas a uma
versão futura com validador formal, em vez de aceitar identificadores livres.

## Consequências

- fundamentos ganham contrato executável e histórico;
- conteúdo público não contamina isolamento privado;
- fontes e limitações ficam auditáveis;
- documentação não diverge silenciosamente do dado;
- a Fase 2 permanece provider-free;
- ativação para retrieval depende de gate posterior e aprovação humana.

## Alternativas rejeitadas

- guardar fundamentos apenas em Markdown livre;
- persistir cada pack como item privado em todos os clientes;
- usar `archive.sqlite` como base editorial;
- copiar corpus ou referências para treinamento;
- declarar todo conteúdo válido como automaticamente aprovado;
- criar banco, CLI, app ou catálogo paralelo.

## Fitness associada

Os testes devem provar:

- schema fechado e fonte/licença separadas;
- bases epistêmicas explícitas em definições e princípios;
- cobertura mínima declarada;
- hash e manifest determinísticos;
- duplicata, ciclo e dependência divergente bloqueados;
- symlink, hardlink e path escape bloqueados;
- nenhum import de provider ou Knowledge Store privado;
- nenhuma carga de `node:sqlite` na ação pública de catálogo;
- candidato não é apresentado como conhecimento aprovado;
- projeção Markdown deriva integralmente do dado canônico e neutraliza conteúdo
  executável ou visualmente enganoso.
