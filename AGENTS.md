# Gerador de Vídeos — Studio Audiovisual Inteligente

Este workspace tem uma única finalidade operacional: gerar, ajustar e finalizar produções audiovisuais com Gemini Omni como gerador principal e um pipeline Studio auditável, extensível e orientado a conhecimento.

Antes de invocar o CLI, leia [`CORE/docs/AGENT-CONTRACT.md`](CORE/docs/AGENT-CONTRACT.md) (gerado): pré-voo, formato de saída, confirmações exigidas por comando e o que nunca fazer. Este arquivo cobre política de workspace; aquele cobre o contrato de invocação do CLI.

## Escopo

- `CORE/`: CLI, app local, Knowledge Core e adapters audiovisuais.
- `CORE/outputs/`: destino padrão dos novos MP4 e recibos.
- `CORE/outputs/<colecao>/`: destino padrão organizado por coleção para novas entregas de vídeo.
- `CORE/diagnosticos/`: logs e artefatos de inspeção, fora das entregas.
- `PESSOAS/`: referências oficiais de pessoas/personagens; conter somente imagens diretas, nomeadas pela pessoa.

Clientes, marcas, pessoas, projetos, produções, entregas e campanhas só podem existir como entidades governadas do Knowledge Core, com escopo, proveniência, direitos e isolamento; não criar árvores soltas ou bancos paralelos para representá-los. Não criar skills, laboratórios ou scorecards estéticos; o gerador de variações/estudos vive no CLI existente, nunca num segundo motor ou servidor. Narração, música, montagem, legendas, HTML motion, acabamento e QA só pertencem ao modo `studio`, quando pedidos por comando/flag explícita e registrados em recibos; nunca entram silenciosamente no fluxo `raw`.

## Contrato Obrigatório de Produção Audiovisual

Toda execução audiovisual neste estúdio deve seguir este contrato estrito:

1. **Checklist Prévia**: Tratar a receita como especificação obrigatória. Montar checklist por cena antes de executar.
2. **Separação por Cena**: Diferenciar claramente presença da pessoa escolhida, cenas visuais, falas, narração off, textos em tela, trilha e mixagem.
3. **Uso de Referência**: Usar a referência autorizada da pessoa EXCLUSIVAMENTE nas cenas em que ela aparece. Nenhuma foto acompanha a distribuição. Cenas visuais/motion DEVEM ser `text_to_video` sem imagem de referência (para evitar frames estáticos indesejados).
4. **Sem Frames de Transição**: Não usar imagens temporárias, thumbnails ou último frame como abertura, salvo quando pedido na receita.
5. **Narração Material Real**: Toda narração prevista deve existir como áudio material real, validado e mixado. O texto em tela não substitui a voz.
6. **Sincronia de Texto e Voz**: Textos em tela acompanham a fala correspondente.
7. **Trilha Sonora Integrada**: Trilha cobre toda a timeline, mixada abaixo das vozes, com corte limpo (sem fade-out automático).
8. **Preservação de Originais**: Montagem e acabamento geram novos arquivos sem sobrescrever os originais.
9. **Validação do Master**: Validar empiricamente a presença de vídeo, áudio, narração, sincronia, trilha e ausência de frames indevidos.
10. **Não-Falsificação**: Nunca declarar entregue apenas por estar no JSON; validar a presença física no arquivo final.
11. **Tabela de Pré-Execução**: Apresentar tabela com Cena, Duração, Pessoa (Sim/Não), Referência, Fala/Narração, Texto em Tela e Trilha antes de rodar.
12. **Gestão de Re-tentativas**: Não regenerar por avaliação estética. Em `production-once`, falhas objetivas previstas na receita usam reconciliação e retry limitado no próprio executor, sem nova decisão humana; estado ambíguo nunca cria uma segunda submissão.


## Knowledge Core e mídia híbrida

- Conhecimento técnico global versionado pode viver em `CORE/knowledge/`; conhecimento privado e mutável deve ficar fora do Git em `%LOCALAPPDATA%\GeradorDeVideos\Knowledge\knowledge.sqlite`.
- Todo dado privado exige `root_scope_id` e acesso por repository único com `ScopeGrant`. Dados, FTS, embeddings, cache, backup e relatórios não podem atravessar clientes por padrão.
- Política de governança versionada é imutável por par ID/hash. Evento novo persiste o `ScopeGrant` canônico dedicado a um único root e prende seu hash à cadeia; evento legado sem o corpo completo permanece legível, mas deve ser contado e apresentado como evidência legada.
- Todo item privado, todo candidato privado persistido e todo candidato de importação exige o envelope governado `knowledge-record-envelope@1`, com classificação, owner, proveniência, modalidade, evidências, retenção, direitos, ator e hash. Campo ausente, hash divergente ou direito necessário diferente de `allowed` falha fechado.
- Evidências e feedback são append-only. Modelos podem propor candidatos; somente decisão humana promove conhecimento ou amplia seu escopo. Feedback nunca gera, edita, regenera ou consome cota.
- Direitos `desconhecido` bloqueiam análise de conteúdo, indexação, embedding, treinamento, reutilização, publicação e envio a provedor. Proveniência conhecida ou asset oficial não concedem consentimento automaticamente.
- Backup e restore do Knowledge Core são provider-free, classificados e ficam fora do workspace. Evento privado persistido sem classificação própria impõe piso conservador `restricted`; piso e quantidade de roots são revalidados no snapshot. O snapshot físico público aceita store vazio ou com uma única raiz; store com múltiplos roots falha fechado. Uma raiz existente exige `root_scope_id` exato e `ScopeGrant`; restore exige destino novo, manifest, checksums e attestation válidos.
- Integridade entre banco, `outputs/` e `PESSOAS/` é read-only e report-only: classifica vínculos governados como `resolved`, `missing`, `revoked` ou `quarantined`, mas não move, apaga, substitui, repara nem persiste quarentena. Links são registrados somente por ação humana explícita; o backup v2 deriva o inventário governado do próprio snapshot. Quarentena persistida exige a ação separada de revisão humana.
- Replay histórico de Knowledge items e releases só pode partir de export/release autorizada, com readers e upcasters puros, versionados e hasheados. Replay especializado de eventos append-only pode partir somente do ledger íntegro do root, por projector puro, versionado e read-only. O payload original nunca é reescrito. A superfície pública de releases aceita somente readers embutidos de schemas persistíveis conhecidos. Importadores de `StyleSpec`, `BrandKit`, `recipe@2`, evidência de referência e metadata sanitizada de receipts apenas deduplicam e propõem candidatos read-only; não escrevem no repository nem promovem conhecimento.
- A ontologia audiovisual global e os sete domain packs em `CORE/knowledge/` são candidatos versionados e provider-free. `knowledge --action packs` apenas expõe manifest e hashes, sem carregar SQLite ou conteúdo integral. Validade estrutural nunca autoriza retrieval, planejamento, provider input ou aprovação editorial.
- A fila de promoção de feedback é uma projeção provider-free, com fatores operacionais explicáveis e snapshot hash-bound. Decisões humanas são append-only; `promote` registra aprovação para a ação humana separada `canonicalize-feedback-interpretation`, enquanto `apply-once` fica preso a `planFingerprint`, produção e expiração sem entrar em release. Uma decisão terminal posterior só substitui outra com `supersedesDecisionId` explícito; canonicalização cria apenas evidência e `preference-rule@1` no mesmo root, nunca release, retrieval, plano ou chamada de provider. Não há ranker automático, score estético ou promoção por contagem. Likes/favoritos humanos de vídeos no app são evidência de feedback append-only (marcadores locais, sem ranquear conteúdo nem gerar cota); só podem influenciar a prioridade de exibição de sugestões de receitas como evidência, com a promoção de preferência permanecendo decisão humana.
- `retrieval-shadow` é a única superfície lexical da Fase 5: read-only, provider-free e sem influência no planner. Ela reconstrói uma projeção FTS5 efêmera dentro de um snapshot, exige release ativa e filtra root/scope, status, retenção e `textualIndexing=allowed`; devolve `retrieval-trace@1` e `knowledge-context@1` com autoridade `none`. Não persiste índice, não consulta embeddings e não envia conteúdo a provider.
- A integração canônica da Fase 6 aceita `studio-brief@1` e um `knowledge-context@1` já materializado. `plan`, `dry-run`, `compile` e `run` podem receber `--knowledge-context <arquivo>`; o compilador cria `knowledge-context-binding@1`, congela brief/contexto no `film-spec@2` e no `execution-plan@1`, e receipts/recipes registram apenas hashes e a projeção mínima. `run`/`resume` nunca refazem retrieval.
- `raw` não consulta Knowledge Core, não usa renderer HTML e não sofre composição. O caminho canônico de Studio permanece `brief + knowledge-context → film-spec@2 → execution-plan@1 → journal → adapters → artefatos/recibos`.
- Entrada externa ad hoc em `image`, `generate` ou no app não consulta o Knowledge Core e exige confirmação humana explícita por invocação (`--confirm-provider-input true` ou checkbox/boolean literal no app). Em uma produção `batch` definida, `--production-authorization <arquivo>` registra essa decisão uma única vez, vinculada a `productionId`, SHA-256, bytes, MIME, papel e operação; retomadas, correções e tentativas seguintes reutilizam somente essa autoridade exata e revalidam o arquivo imediatamente antes do adapter. Alterar produção, conteúdo, papel ou operação falha fechado. Referências do fluxo Studio canônico continuam dependentes de direitos vigentes do Knowledge Core; sidecar legado é somente `report-only`.
- Não criar segundo compilador, planner, timeline, executor, CLI, app ou servidor. Novos domínios e ferramentas compilam para a espinha existente.
- HTML/Canvas é Studio-only, local e determinístico: rede, cookies, segredos, downloads implícitos e filesystem não declarado ficam bloqueados; browser, fontes, dependências e ambiente são pinados e registrados.
- O contexto criativo congela no plano, mas rights/revocation/capability são revalidados pelo runtime guard antes de cada uso. Revogação ou capability expirada falha fechada e não autoriza fallback ou retry.
- Adapters externos futuros exigem autorização explícita de política, capability registry, segredos fora do projeto, recibos e o mesmo gate de gasto. Gemini permanece cookie-only.

## Autenticação fundamental: cookie-only

- Este projeto não usa, não lê e não aceita `GEMINI_API_KEY` nem `--auth api` em execução produtiva.
- Toda geração de imagem e vídeo Omni usa sessão Google autenticada em Playwright headless. A narração externa usa exclusivamente Google Vids; Flow Music usa sua sessão autenticada própria, filtrada no cofre `FlowMusic`. O padrão é `--auth credential-manager`; `--auth har --har <arquivo>` serve somente para importar cookies Google em um contexto descartável do Omni, enquanto Flow Music aceita apenas Credential Manager.
- Para evitar login recorrente, `npm run session -- setup --provider google|flow-music` abre um Chrome comum para login manual e mantém um perfil compartilhado em `%LOCALAPPDATA%\GeradorDeVideos\BrowserSessions\google-ai-studio`, fora do projeto. Flow pode reaproveitar o login Google desse perfil, mas seus cookies continuam filtrados para o cofre `FlowMusic`. Não automatizar a tela de login com Playwright. O perfil é a fonte renovável; o Credential Manager é apenas o cache usado pelos contextos descartáveis.
- `session refresh` pode renovar o cache sem interação enquanto o provedor mantiver a sessão. Renovação automática só pode ocorrer antes de qualquer POST gerativo; nunca autoriza repetição depois que uma chamada pode ter alcançado o provedor.
- Cookies, cabeçalhos de sessão e tokens nunca entram em prompt, log, estado, recibo ou artefato. O recibo registra somente o modo não secreto da autenticação.
- Testes são provider-free, usam dublês locais e nunca consomem cota nem exigem cookies reais.
- **Não existe confirmação de gasto.** A flag `--confirm-paid` foi removida do projeto inteiro em 07/08/2026: este é um estúdio local, a autenticação é por cookie e não há custo medido por chamada, então a confirmação não protegia nada e só somava uma etapa. Não reintroduzir. Isso não afeta `--confirm-provider-input` (segurança contra permit forjado), `--confirm-human` (decisão editorial), `--confirm-drive-write` nem `--confirm-local-media-delete`.
- Enquanto não houver contrato cookie-only verificado, ficam bloqueados: refine por `interactionId` e QA semântico. Para editar vídeo, usar `generate --task edit --video`.
- Gemini TTS direto e Lyria Realtime não fazem parte das capacidades do projeto. Não reintroduzir adapters, comandos, presets ou fallbacks para essas rotas; usar Google Vids para narração, Whisper local para sincronismo e Flow Music para trilhas.
- Flow Music está disponível como backend cookie-only do comando `music` e `audio-recipe`. O adapter preserva o original do provedor sem cortes (`preserveOriginalDuration: true`), injeta tags de formato curto (`[Format: 20-second short commercial radio cue, instrumental only, no vocals]`), publica master WAV com recibos e estado de tentativa, aplica corte limpo sem fade-out e nunca repete automaticamente uma submissão ambígua.
- Receitas de áudio (`audio-recipe`) operam por padrão na estratégia `music-first`: a trilha orgânica gerada pelo Flow Music lidera a timeline, a locução (Google Vids) é dimensionada pela cadência de 2,4 a 2,6 palavras/segundo com ganho reforçado de +11 dB a +15 dB na voz e +7 dB a +10 dB na música, e a mixagem master preserva o desfecho acústico natural com arremate musical perfeito de 3 a 5 segundos sem corte e sem fade-out.
- **Regra de Ouro da Sincronia Perfeita & Supressão Vocal Absoluta (Flat Motion Graphics Pro):** O padrão definitivo para alinhamento palavra por palavra no estúdio:
  1. **Alinhamento Whisper**: Extrair a minutagem precisa de cada palavra falada da locução via Whisper local (`transcribeWordTimestamps`).
  2. **Rotulagem Semântica Visual Anti-Voz**: O prompt de cada cena NUNCA deve parecer roteiro de fala. Cada palavra deve ser rotulada estritamente como ativo gráfico 2D em tela (ex: `[ON-SCREEN 2D GRAPHIC TEXT - DO NOT SPEAK]: T:0.0s-0.9s -> 2D Kinetic Reveal: [BEM-VINDO]`).
  3. **Diretriz de Áudio de Supressão Vocal Estrita (Zero Vocals)**: Injetar sempre o bloco contundente:
     `[CRITICAL AUDIO INSTRUCTION - ZERO SPOKEN WORDS, ZERO NARRATION, ZERO VOICES, ZERO SPEECH, ZERO TALKING, ZERO WHISPERING, ZERO VOCALS. ALL WORDS ARE SILENT 2D GRAPHIC ELEMENTS ON SCREEN. AUDIO TRACK MUST BE 100% PURE MOTION GRAPHICS SOUND DESIGN (SFX ONLY: Crisp UI clicks, loud dynamic whooshes, digital pops, heavy sub-bass impacts)]`.
  4. **Estilo Flat Motion Graphics 2D de Alto Padrão**: Foco absoluto em design 2D flat moderno, tipografia cinética expressiva, grids suíços dinâmicos, shape transitions, kinetic highlights e recortes gráficos sem uso de 3D genérico.
  5. **Sound Design Omni Sincronizado**: Instruir o Omni a concentrar todo o processamento de áudio em efeitos sonoros táteis e dinâmicos sincronizados com a revelação de cada palavra (whooshes, clicks, risers, impacts, glitches, sub-bass hits).
  6. **Mixagem Master Acústica**: Mixar a locução master real (`+15dB`), a trilha Flow Music (`+10dB`) e atenuar os SFX do Omni em `-10dB` (`volume=-10dB`), garantindo máxima clareza da voz, equilíbrio da música e impacto sutil dos efeitos visuais.

## Referências de pessoas

- Nenhuma pessoa ou foto é pré-selecionada na instalação.
- Use apenas o arquivo escolhido pelo usuário e autorizado para a produção.
- Não substituir referências por imagens temporárias ou derivadas sem pedido explícito.
- Preserve os arquivos locais. Pessoas, assets e direitos continuam no Knowledge Core existente.

## Modos

- `raw` é o padrão compatível: prompt literal, zero a quatro referências explicitamente confirmadas para a invocação, uma chamada `gemini-omni-flash-preview`, MP4 original e recibo.
- `studio` é opt-in: `--style` autoriza composição auditável; em `production-once` a autorização congelada da produção também governa a continuidade do draft/keyframe e `run` segue até a entrega sem pausa editorial. Workflows legados podem declarar `pause-for-review`. Áudio, montagem, acabamento e QA são cópias/etapas separadas e preservam os originais.
- `dry-run` nunca escreve nem chama provedor.
- Estado ambíguo nunca autoriza repetição cega. O executor deve usar `status`/`reconcile` automaticamente; só cria nova tentativa quando a reconciliação comprovar rejeição terminal ou ausência de efeito, dentro do limite da autorização da produção.

Sem `--style`, não reescrever, pontuar ou expandir o prompt. Não alterar resolução, fps, duração, áudio, logo ou cor depois do Omni sem comando explícito de modo `studio`. Preservar `userPrompt` e `effectivePrompt` separadamente no recibo quando houver composição.

Não aplicar fade-out automático na trilha, na narração nem no master. O padrão é encerrar o áudio por corte limpo na duração da timeline (`fadeOut: 0`). Fade-out só pode ser usado quando o usuário o pedir explicitamente; nesse caso, registrar a duração no recibo.

## Geração direta por padrão

- Para uma nova peça, preparar o requisito completo no prompt e fazer uma única chamada Omni por clipe. Em sequências, usar uma passagem por parte e juntar os MP4 compatíveis por stream-copy.
- Para direção literal por React/JSX, usar `--mode studio --style react-audiovisual@1`. Em testes e pesquisas com vários clipes, usar `batch --research-profile react-audiovisual@1`: preservar os originais e recibos e, somente após todos os jobs válidos, publicar também o vídeo unido na ordem dos jobs.
- Depois de uma saída tecnicamente válida, verificar prompt/task, integridade, duração, streams e recibo. Quando a produção declarar `automaticCorrections: true`, evidência objetiva prevista na receita (como alinhamento Whisper contra o roteiro aprovado) pode acionar uma correção automática limitada, sem alterar texto, intenção ou assets autorizados.
- Não criar segundo executor nem loop ilimitado de correção. Correções e novas tentativas vivem no executor existente, preservam tentativas aceitas, usam a autorização única da produção e respeitam `maxAttempts` entre 1 e 3.
- Se texto, narração, música, sincronismo ou estética vierem imperfeitos, entregar o original e explicar a limitação. Não consumir nova cota por decisão autônoma.
- Requisitos como corte seco, ausência de fade, texto exato e voz devem entrar no prompt inicial. Falha local anterior ao envio pode retomar automaticamente; estado ambíguo exige reconciliação antes de decidir entre recuperar o artefato e abrir nova tentativa.

## Fluxo Studio retomável

1. `dry-run` ou `plan` valida `filme.json`, orçamento e chamadas pagas.
2. `run` em `production-once` gera voz, trilha e visuais em paralelo quando independentes, registra a continuidade automática e executa animação, montagem, mix, legenda, QA e entrega na mesma invocação.
3. Se a execução cair, `resume` reutiliza plano, journal e autorização; não pede nova aprovação editorial e não repete nós concluídos.
4. `approve --draft ...` permanece apenas para workflows legados que declarem `completionMode: pause-for-review`.
5. O alvo de parede é 300 s. Ultrapassá-lo registra `over-budget-running` e intensifica a reconciliação da mesma tentativa, mas nunca cancela trabalho em progresso nem autoriza reenvio.
6. Cada etapa publica artefato de forma atômica, sem sobrescrita, e encadeia recibos.

## Coleções de saída

Sem `--out`, salvar vídeos em uma coleção nomeada e padronizada dentro de `CORE/outputs/<colecao>/`:

- `videos-soltos/`: MP4 original de cada parte.
- `receitas/`: recibos completos de cada parte e recibo de montagem da coleção.
- `videos-unidos/`: MP4 final com todas as partes juntas, por cópia quando houver uma parte ou concatenação stream-copy quando houver várias.
- `metadados/`: lista de concatenação e metadados operacionais.

Ao gerar partes do mesmo pedido, reutilizar a mesma coleção via `--collection`.

## Publicação diária no Google Drive

A publicação no Drive é uma etapa de entrega Studio explícita, posterior à
geração e à validação técnica. Nunca publicar silenciosamente no fluxo `raw`.

Quando o usuário fornecer ou confirmar uma pasta-raiz do Drive, usar o comando
canônico `drive-deliver`. Ele organiza cada produção assim:

```text
AAAA-MM-DD/
  nome-da-peca/
    videos/
    receitas/
```

Executar primeiro o dry-run. A escrita externa exige confirmação literal na
mesma invocação:

```powershell
npm run video -- drive-deliver --collection nome-da-colecao --root-folder-id <id-ou-url> --client meu-cliente --dry-run true
npm run video -- drive-deliver --collection nome-da-colecao --root-folder-id <id-ou-url> --client meu-cliente --dry-run false --confirm-drive-write true
```

O comando seleciona masters de `videos-unidos/`, reúne os JSON de `receitas/` e
os sidecars `*.receipt.json`, cria/reutiliza as pastas exatas e falha fechado em
duplicidade ou conteúdo divergente. Nome, tamanho e MD5 são relidos no Drive.
Um recibo `drive-daily-delivery` é mantido localmente e também enviado para
`receitas/`. Nunca guardar tokens ou segredos no manifesto ou no recibo.

## Entrega no chat

Por padrão, entregar no chat somente um resumo curto para reduzir custo de contexto:

- título e sinopse breve, quando houver história;
- estado final da execução e quantidade de vídeos;
- link do vídeo final e link da coleção ou do recibo principal.

Não listar no chat prompts completos, todos os recibos, IDs, tokens ou tempos por etapa, salvo pedido explícito do usuário. Manter essas informações completas no JSON final do CLI, nos recibos e nos metadados da coleção. Em caso de falha, informar apenas a etapa, a mensagem sanitizada e a decisão tomada.

## Comandos

Executar em `CORE/`:

```powershell
npm run app
npm run doctor
npm run session -- status
npm run session -- setup --provider google
npm run session -- refresh --provider google
npm run video -- knowledge
npm run video -- knowledge --action packs
npm run video -- knowledge --action init
npm run video -- knowledge --action integrity
npm run video -- knowledge --action backup --db C:\store\knowledge.sqlite --root-scope-id <id> --classification confidential --out C:\backup\knowledge.mkvbackup
npm run video -- knowledge --action restore --backup C:\backup\knowledge.mkvbackup --root-scope-id <id> --db C:\restore\knowledge.sqlite
npm run video -- knowledge --action active-release --db C:\store\knowledge.sqlite --root-scope-id <id>
npm run video -- knowledge --action activate-release --db C:\store\knowledge.sqlite --root-scope-id <id> --release-id <id> --expected-activation-id none --reason "aprovação" --confirm-human true
npm run video -- knowledge --action rollback-release --db C:\store\knowledge.sqlite --root-scope-id <id> --release-id <id-anterior> --expected-activation-id <ativação-atual> --reason "rollback" --confirm-human true
npm run video -- knowledge --action review-item --db C:\store\knowledge.sqlite --root-scope-id <id> --item-id <id> --operation promote|quarantine --expected-revision <n> --expected-content-hash <sha256> --reason "decisão" --confirm-human true
npm run video -- knowledge --action register-asset-link --db C:\store\knowledge.sqlite --root-scope-id <id> --input C:\specs-privados\asset-link.json --reason "registro" --confirm-human true
npm run video -- knowledge --action import-candidate --db C:\store\knowledge.sqlite --root-scope-id <id> --input C:\specs-privados\knowledge-import.json
npm run video -- knowledge --action replay-release --db C:\store\knowledge.sqlite --root-scope-id <id> --release-id <id>
npm run video -- knowledge --action capture-feedback --db C:\store\knowledge.sqlite --root-scope-id <id> --input C:\specs-privados\feedback.json --confirm-human true
npm run video -- knowledge --action list-feedback --db C:\store\knowledge.sqlite --root-scope-id <id>
npm run video -- knowledge --action replay-feedback --db C:\store\knowledge.sqlite --root-scope-id <id>
npm run video -- knowledge --action create-feedback-interpretation-candidate --db C:\store\knowledge.sqlite --root-scope-id <id> --input C:\specs-privados\feedback-interpretation.json --confirm-human true
npm run video -- knowledge --action list-feedback-interpretation-candidates --db C:\store\knowledge.sqlite --root-scope-id <id>
npm run video -- knowledge --action replay-feedback-interpretation-candidates --db C:\store\knowledge.sqlite --root-scope-id <id>
npm run video -- knowledge --action list-feedback-promotion-queue --db C:\store\knowledge.sqlite --root-scope-id <id> --limit 5
npm run video -- knowledge --action review-feedback-interpretation --db C:\store\knowledge.sqlite --root-scope-id <id> --input C:\specs-privados\feedback-promotion-decision.json --confirm-human true
npm run video -- knowledge --action canonicalize-feedback-interpretation --db C:\store\knowledge.sqlite --root-scope-id <id> --input C:\specs-privados\feedback-canonicalization-request.json --confirm-human true
npm run video -- knowledge --action retrieval-shadow --db C:\store\knowledge.sqlite --root-scope-id <id> --input C:\specs-privados\retrieval-request.json
npm run video -- plan --spec filme.json --knowledge-context C:\specs-privados\retrieval-result.json
npm run catalog:knowledge-packs:check
npm run catalog:ontology:check
npm run video -- generate --mode raw --prompt "direção" --image "C:\imagem.png" --confirm-provider-input true --aspect 16:9 --collection nome-da-colecao
npm run video -- generate --mode studio --style aquarela-2d@1 --prompt "direção" --collection nome-da-colecao
npm run video -- generate --task edit --video <arquivo.mp4> --confirm-provider-input true --prompt "mais lento e com luz quente" --collection nome-da-colecao
npm run video -- drive-deliver --collection nome-da-colecao --root-folder-id <id-ou-url> --client meu-cliente --dry-run true
npm run video -- drive-deliver --collection nome-da-colecao --root-folder-id <id-ou-url> --client meu-cliente --dry-run false --confirm-drive-write true
npm run video -- dry-run --spec filme.json
npm run video -- plan --spec filme.json
npm run video -- run --state outputs/<filme>/metadados/film-state.json
npm run video -- approve --draft outputs/<filme>/metadados/draft.json
npm run video -- resume --state outputs/<filme>/metadados/film-state.json
npm run video -- status --state outputs/<filme>/metadados/film-state.json
npm run organize:outputs
npm run check
```

O CLI usa os cookies do Windows Credential Manager por padrão. O app local não contém credenciais de provedor; `OMNI_UPSTREAM_URL` é opcional para encaminhamento a um serviço já autenticado.
