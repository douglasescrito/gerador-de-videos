# ADR 0004 — Backup single-root e inventário governado de mídia

> Nota da distribuição: este ADR registra uma decisão e seu estágio histórico.
> Para operar hoje, consulte o [contrato do CLI](../AGENT-CONTRACT.md) e o
> [AGENTS.md](../../../AGENTS.md). Menções históricas a gasto, pausas, providers
> ou caminhos não substituem os contratos atuais. Não reintroduza confirmação
> de gasto, Gemini TTS ou Lyria Realtime. Testes e recibos privados não acompanham
> este documento; os estados históricos não são prova da instalação atual.

- Estado da decisão: aceita
- Estado da implementação: implementada e coberta por testes provider-free
- Data: 2026-07-24
- Escopo: Knowledge Store, `outputs/`, `PESSOAS/`, backup e restore

## Contexto

O `knowledge.sqlite` é um store físico privado capaz de conter mais de um
`root_scope_id`. Um snapshot SQLite, porém, sempre captura o arquivo inteiro.
Logo, autorizar backup com o grant de um único cliente sobre um store
multi-root copiaria também dados de roots que o ator não pode ler.

Os binários de `CORE/outputs/` e `PESSOAS/` não pertencem ao SQLite e possuem
ciclos de vida próprios. Copiá-los silenciosamente para o bundle faria o
backup misturar autoridade editorial, armazenamento de mídia e direitos de
uso. Receber uma lista manual de arquivos também criaria uma segunda fonte de
verdade, possivelmente divergente do snapshot.

## Decisão

A superfície pública de backup aceita:

1. store vazio, sem attestation de root; ou
2. store físico com exatamente um root, identificado por `rootScopeId` e
   autorizado por `ScopeGrant`.

Um store físico com mais de um root falha antes da criação do snapshot. A
quantidade de roots é verificada novamente no snapshot consistente e deve ser
idêntica à do pré-voo; um root criado concorrentemente aborta o bundle antes do
manifest. Essa é uma estratégia deliberadamente segura, não uma limitação a ser
contornada com um grant mais amplo. Backup multi-root só poderá existir após
uma nova decisão que defina segregação física, autoridade administrativa
explícita e formato capaz de provar a separação.

O manifest atual é `knowledge-backup-manifest@2`. Depois de criar o snapshot
SQLite consistente, o backup:

- abre o repository sobre o snapshot, não sobre o banco vivo;
- lista os `knowledge-asset-link-payload@1` daquele root;
- resolve apenas as raízes canônicas `CORE/outputs/` e `PESSOAS/`;
- registra hashes, tamanho esperado, governança e observação sanitizada;
- não inclui paths absolutos nem bytes da mídia;
- não aceita inventário manual.

Um link criado no banco vivo depois do snapshot não entra naquele manifest.
Arquivos não vinculados podem aparecer como contagem de extras no diagnóstico,
mas não são incorporados ao inventário governado.

## Restore

O restore de manifest v2:

1. valida bundle, checksums, store, ledger e attestation;
2. abre o repository sobre o SQLite temporário extraído;
3. exige igualdade exata entre os vínculos do snapshot e a projeção persistente
   do manifest;
4. revalida os arquivos nas duas raízes canônicas;
5. publica o banco em destino novo mesmo quando a mídia estiver ausente,
   divergente, revogada ou quarentenada;
6. retorna `restored-asymmetric` nesses casos;
7. nunca cria, copia, move, apaga, substitui ou quarentena mídia.

`knowledge-backup-manifest@1` permanece legível. A opção histórica
`assetRootDirectory` é aceita somente para bundles v1 e não participa de
backups novos.

## Consequências

- Um grant de cliente nunca autoriza snapshot de dados pertencentes a outro
  cliente.
- Banco e inventário são coerentes no mesmo ponto temporal.
- Restore não confunde recuperação do conhecimento com reparo de mídia.
- Assimetria preserva evidência e exige decisão humana posterior.
- Backup de um store consolidado multi-root permanece indisponível até existir
  um desenho seguro comprovado.

## Alternativas rejeitadas

- Fazer snapshot global com o grant de um dos roots.
- Filtrar ou reescrever o SQLite durante o backup.
- Aceitar `relativePaths` fornecidos pelo chamador.
- Embutir todos os arquivos de `outputs/` e `PESSOAS/` no bundle.
- Tratar ausência de mídia como motivo para apagar ou rejeitar o banco
  restaurado.
- Repetir, gerar ou reparar mídia automaticamente após restore.

## Fitness associada

Os testes devem provar:

- bloqueio antes do snapshot para store multi-root;
- bloqueio depois do snapshot quando um segundo root surge entre as leituras;
- manifest derivado exclusivamente do snapshot;
- cobertura conjunta de `outputs` e `PESSOAS`;
- ausência de paths absolutos e conteúdo de mídia;
- bloqueio de manifest divergente do SQLite antes do commit;
- restore simétrico e assimétrico sem mutação de assets;
- compatibilidade de leitura e restore do manifest v1;
- nenhuma importação de provider e nenhuma alteração no caminho `raw`.
