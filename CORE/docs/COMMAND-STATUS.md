# Status dos comandos

> Documento gerado de `lib/cli/command-registry.mjs` (opções e política de cada comando) e de `lib/cli/commands/<id>.mjs` (cobertura do contrato `executar(contexto)`), mais o provider registry.
> Não editar manualmente. Regere com `node scripts/generate-governance-docs.mjs`.

Total: 75 comandos. 1 `blocked`; 74 `supported`.

Contratos protegidos: `approve`, `status`, `resume`, `reconcile`. Todos permanecem suportados.

Consumidores são uma varredura conservadora de menções explícitas, agrupada em `scripts`, `library`, `tests` e documentos Markdown da raiz. A biblioteca inclui o contexto e os módulos de comandos do CLI. Os números orientam revisão; não provam uso em produção.

| Comando | Status | Protegido | Opções | Confirmação | Capacidade | Consumidores | Substituto ou limitação |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| `text` | `supported` | não | 7 | não | — | scripts:0; library:4; tests:2; docs:0 | Cookie-only, sem retry automático. Produto disponível; shorten/opening/vertical/rewrite bloqueados enquanto o chat do AI Studio retornar erro interno. |
| `render` | `supported` | não | 10 | não | — | scripts:0; library:1; tests:1; docs:0 | Entrada JSON de cena, sem JSX/HTML arbitrário, rede, assets externos ou áudio implícito. --dry-run false renderiza; --recover-existing true reconcilia a mesma publicação. |
| `help` | `supported` | não | 1 | não | — | scripts:2; library:1; tests:2; docs:0 | — |
| `docs` | `supported` | não | 1 | não | — | scripts:0; library:2; tests:2; docs:0 | — |
| `capabilities` | `supported` | não | 9 | não | — | scripts:0; library:3; tests:2; docs:0 | — |
| `doctor` | `supported` | não | 2 | não | — | scripts:0; library:1; tests:1; docs:1 | — |
| `styles` | `supported` | não | 5 | não | — | scripts:1; library:1; tests:2; docs:0 | — |
| `tecnicas` | `supported` | não | 5 | não | — | scripts:0; library:1; tests:1; docs:0 | — |
| `image` | `supported` | não | 14 | não | — | scripts:0; library:3; tests:3; docs:0 | — |
| `generate` | `supported` | não | 27 | não | — | scripts:1; library:7; tests:7; docs:1 | — |
| `refine` | `blocked` | não | 10 | não | — | scripts:0; library:1; tests:0; docs:0 | Substituto: generate --task edit --video <arquivo.mp4>. Edição por interactionId não possui contrato cookie-only verificável. |
| `batch` | `supported` | não | 22 | não | — | scripts:2; library:10; tests:2; docs:0 | — |
| `draft` | `supported` | não | 6 | não | — | scripts:0; library:2; tests:3; docs:0 | — |
| `approve` | `supported` | sim | 3 | não | — | scripts:0; library:2; tests:3; docs:0 | — |
| `animate` | `supported` | não | 8 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `finish` | `supported` | não | 7 | não | — | scripts:0; library:0; tests:0; docs:1 | — |
| `drive-deliver` | `supported` | não | 13 | `--confirm-drive-write true` quando `--dry-run false`; `--confirm-local-media-delete true` quando `--cleanup-local-media true` | — | scripts:0; library:1; tests:0; docs:0 | — |
| `daily-commercials` | `supported` | não | 10 | `--confirm-drive-write true` quando `--action archive e --dry-run false`; `--confirm-local-media-delete true` quando `--action archive e --dry-run false` | — | scripts:0; library:1; tests:0; docs:0 | — |
| `voices` | `supported` | não | 4 | não | — | scripts:0; library:2; tests:1; docs:0 | — |
| `tts` | `supported` | não | 10 | não | `google-vids` (`supported`) | scripts:1; library:4; tests:1; docs:0 | Substituto: Use provider omni somente por decisão humana após falha de preflight ou reconciliação explícita. A UI do Google Vids é experimental; o catálogo autenticado observado em 2026-08-12 contém 37 vozes e pode mudar no provedor. O adapter valida e confirma a voz selecionada antes de submeter, cria uma nova cena por padrão e nunca repete automaticamente uma submissão ambígua. |
| `audio-recipe` | `supported` | não | 35 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `flow-video` | `supported` | não | 11 | não | `google-flow-video` (`supported`) | scripts:0; library:1; tests:1; docs:0 | Substituto: Use gemini-omni quando o provedor principal voltar. Caminho secundário ao gemini-omni pelo Google Flow (Omni 1.1 Flash). Clipes de 4 a 10 s em 1280x720 com áudio, lote de até 4 por submissão, ~12 créditos por clipe, sem marca-d'água. Sem reconciliação. |
| `flow-image` | `supported` | não | 9 | não | `google-flow-image` (`supported`) | scripts:0; library:1; tests:1; docs:0 | Substituto: Use gemini-image quando o provedor principal voltar. Substituto do gemini-image enquanto o AI Studio devolve 404. O painel do Flow anuncia 0 créditos para imagem, mas o custo é do provedor e pode mudar. |
| `vids-video` | `supported` | não | 8 | não | `google-vids-video` (`supported`) | scripts:0; library:0; tests:0; docs:0 | Substituto: Use gemini-omni assim que o provedor voltar; este caminho existe para a janela em que o Omni do AI Studio está fora. Caminho secundário ao gemini-omni, para a janela em que o Omni do AI Studio está fora. Clipe de 10 s fixos em 1280x720 com áudio, comando só em inglês, marca ✦ queimada no canto inferior direito e cota mensal de 50 gerações. Sem reconciliação. |
| `music` | `supported` | não | 9 | não | `flow-music` (`supported`) | scripts:2; library:5; tests:4; docs:0 | Adapter acompanha a UI experimental do Flow; preserva o original, publica WAV com recibos e nunca repete automaticamente estado ambíguo. |
| `audio-bank` | `supported` | não | 11 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `voice-fit` | `supported` | não | 6 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `mix` | `supported` | não | 15 | não | — | scripts:2; library:0; tests:0; docs:0 | — |
| `join` | `supported` | não | 6 | não | — | scripts:2; library:1; tests:0; docs:0 | — |
| `mux-audio` | `supported` | não | 7 | não | — | scripts:2; library:0; tests:0; docs:0 | — |
| `captions` | `supported` | não | 10 | não | — | scripts:0; library:0; tests:0; docs:1 | — |
| `plan` | `supported` | não | 7 | não | — | scripts:0; library:1; tests:3; docs:1 | — |
| `dry-run` | `supported` | não | 7 | não | — | scripts:1; library:9; tests:2; docs:1 | — |
| `run` | `supported` | não | 14 | não | — | scripts:0; library:6; tests:5; docs:0 | — |
| `resume` | `supported` | sim | 12 | não | — | scripts:0; library:7; tests:3; docs:1 | — |
| `status` | `supported` | sim | 5 | não | — | scripts:1; library:8; tests:2; docs:1 | — |
| `reconcile` | `supported` | sim | 7 | não | — | scripts:0; library:6; tests:1; docs:1 | — |
| `qa-override` | `supported` | não | 4 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `qa-scene-override` | `supported` | não | 5 | não | — | scripts:0; library:1; tests:0; docs:0 | — |
| `hoje` | `supported` | não | 5 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `colher` | `supported` | não | 3 | não | — | scripts:0; library:2; tests:0; docs:0 | — |
| `rodada` | `supported` | não | 10 | não | — | scripts:0; library:0; tests:1; docs:0 | — |
| `jobs` | `supported` | não | 4 | não | — | scripts:0; library:6; tests:2; docs:0 | — |
| `usage` | `supported` | não | 5 | não | — | scripts:0; library:2; tests:0; docs:0 | — |
| `storage` | `supported` | não | 5 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `provider-health` | `supported` | não | 2 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `reuse` | `supported` | não | 16 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `hybrid-pilot` | `supported` | não | 15 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `motion` | `supported` | não | 10 | não | — | scripts:0; library:0; tests:3; docs:0 | — |
| `variant` | `supported` | não | 8 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `provenance` | `supported` | não | 6 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `prompts` | `supported` | não | 22 | não | — | scripts:0; library:2; tests:0; docs:0 | — |
| `batches` | `supported` | não | 7 | não | — | scripts:0; library:1; tests:1; docs:0 | — |
| `lote` | `supported` | não | 18 | não | — | scripts:0; library:1; tests:1; docs:0 | — |
| `c2pa` | `supported` | não | 6 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `compile` | `supported` | não | 7 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `executor` | `supported` | não | 5 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `knowledge` | `supported` | não | 20 | `--confirm-human true` quando `--action em activate-release, rollback-release, review-item, provision-scopes, register-asset-link, capture-feedback, create-feedback-interpretation-candidate, review-feedback-interpretation ou canonicalize-feedback-interpretation` | — | scripts:0; library:1; tests:2; docs:0 | Provider-free e isolado de raw; memória, integrity, feedback e decisões shadow não geram mídia nem consomem cota. |
| `director` | `supported` | não | 20 | `--confirm-human true` quando `--action register`; `--confirm-human true` quando `--action materialize` | — | scripts:0; library:0; tests:1; docs:0 | Provider-free: perfis ficam no Knowledge Core; likes são evidência append-only e nunca promovem preferência nem geram mídia automaticamente. |
| `index` | `supported` | não | 4 | não | — | scripts:2; library:1; tests:0; docs:0 | — |
| `search` | `supported` | não | 10 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `review` | `supported` | não | 8 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `qa` | `supported` | não | 14 | não | `gemini-vision` (`blocked`) | scripts:0; library:2; tests:0; docs:1 | Substituto: Use QA técnico local explícito e report-only. QA técnico local é opt-in e report-only; QA semântico permanece bloqueado. |
| `commercial` | `supported` | não | 14 | não | — | scripts:1; library:2; tests:0; docs:0 | — |
| `align` | `supported` | não | 22 | não | — | scripts:2; library:1; tests:0; docs:0 | Opt-in e report-only; --corrigir true adota a grafia do roteiro para palavras foneticamente próximas mantendo os timestamps medidos. |
| `sync-batch` | `supported` | não | 7 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `recipe` | `supported` | não | 45 | não | — | scripts:0; library:6; tests:4; docs:0 | Provider-free. Entrada exclusiva por --file, --stdin ou --json. suggest também aceita --brief, --objective, --duration, --aspect, --project-id, --root-scope-id e --style; --brief-id é opcional e deriva do conteúdo quando ausente. --audience e --cta são opcionais; --required-text, --restriction, --reference, --preference e --accessibility podem repetir. --structure auto seleciona progressão; --story-file fornece fatos; --modules-file ativa módulos canônicos; --shots-file vincula referências por cena; --direction-file preserva decisão humana; --composition-file combina componentes compatíveis listados em styles. recipe profiles lista perfis versionados; suggest --profile <id> fornece estilo, estrutura e módulos, dispensando --style. Overrides de estrutura, componentes e módulos são explícitos na evidência; estilo divergente é recusado. hibrido@1 usa texto local sobre o clipe, sem HTML nem sincronia automática. Não concede direitos nem refaz retrieval; bytes e runtime são revalidados antes do uso. |
| `receita` | `supported` | não | 4 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `receitas` | `supported` | não | 9 | não | — | scripts:0; library:1; tests:1; docs:0 | — |
| `variar-receitas` | `supported` | não | 17 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `agendar-receitas` | `supported` | não | 10 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `favoritos` | `supported` | não | 6 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `producao` | `supported` | não | 3 | não | — | scripts:0; library:0; tests:0; docs:0 | — |
| `commands` | `supported` | não | 4 | não | — | scripts:1; library:3; tests:2; docs:1 | — |
| `sfx` | `supported` | não | 5 | não | — | scripts:1; library:1; tests:0; docs:0 | — |

## Decisões protegidas

- `approve`, `status`, `resume` e `reconcile` são contratos suportados e não são candidatos a poda.
- `refine` por `interactionId` permanece bloqueado; a edição suportada envia o MP4 com `generate --task edit --video`.
- `tts` usa Google Vids e `music` usa Flow Music; rotas alternativas de áudio não fazem parte do CLI.
- `qa` semântico permanece bloqueado; QA técnico e `align` são provider-free e report-only. Uma produção que declare `automaticCorrections: true` pode consumir essa evidência no executor existente, dentro da autorização e do limite de tentativas.
