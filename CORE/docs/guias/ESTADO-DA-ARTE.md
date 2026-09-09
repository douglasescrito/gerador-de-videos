# Pipeline Studio — arquitetura evoluída

Este documento descreve o estado operacional do pipeline Studio. O modo `raw` continua literal e compatível. Todas as capacidades abaixo pertencem ao modo `studio`, são auditáveis e não autorizam chamadas de provedor sem autorização de direitos vigente.

## Fluxo canônico

1. `film-spec@2` é compilado de forma determinística em `execution-plan@1` e `timeline@1`.
2. A voz mestre é gerada e medida. Cues de palavra, frase e bloco precisam ser monotônicos e completos.
3. A trilha é ajustada à duração medida por trim ou loop com crossfade, sem `atempo`.
4. A timeline é bloqueada a partir de cues medidos; timestamps não são inventados.
5. Keyframes passam por lint/QA técnico. O animatic FFmpeg encadeia timeline, keyframes, voz, música e cards.
6. A aprovação do animatic referencia seu fingerprint exato. Qualquer alteração invalida a autorização.
7. Vídeos Omni só são admitidos após aprovação; o pool padrão é 3, sem retry automático e com handle persistido antes do polling.
8. O áudio dos clipes Omni é descartado. Motion typography, logo, claims e CTA são camadas determinísticas.
9. QA por cena bloqueia a montagem. QA master bloqueia a entrega. Overrides humanos têm autor, justificativa e fingerprint do relatório.
10. Masters e variantes derivam da mesma timeline e recebem recibos próprios.

## Segurança de execução

- `dry-run` valida sem escrever nem chamar provedor.
- Um `attemptId` nasce antes do POST. Omni persiste `attemptId → fileId` antes de responder ao CLI.
- Estados ambíguos nunca autorizam repetição automática; `reconcile` faz somente GET/status/download.
- Mux falha antes do FFmpeg se o áudio exceder o vídeo.
- Artefatos e recibos são publicados atomicamente e não são sobrescritos.
- O journal SQLite usa WAL, `synchronous=FULL`, eventos transacionais e snapshot reconstruível.
- Mudanças temporais invalidam derivados locais; mudanças visuais invalidam somente os nós pagos afetados.

## Operação

```powershell
npm run video -- compile --spec filme-v2.json --out execution-plan.json
npm run video -- jobs --root outputs
npm run video -- usage --root outputs
npm run video -- storage --step report --root outputs
npm run video -- provider-health --endpoint http://127.0.0.1:3000
npm run video -- reconcile --state outputs/<filme>/metadados/film-state.json --stage video --scene <id>
```

Reuso aprovado:

```powershell
npm run video -- index --root outputs --db outputs/archive.sqlite
npm run video -- review --db outputs/archive.sqlite --receipt <recibo> --status approved
npm run video -- reuse --db outputs/archive.sqlite --source-receipt <recibo-equivalente> --policy require-approved --out <destino.mp4>
```

`recipe@2` inclui operação, provedor/modelo, prompt efetivo, task, aspecto, resolução, timing, parâmetros semânticos, hashes de inputs, preset, brand kit, caption style e políticas. Timeout, polling e caminhos locais não alteram o hash. Um hit só ocorre com review `approved`, receipt válido e hash atual do artefato; a saída é cópia atômica com recibo `reuse-artifact`.

Acabamento derivado:

```powershell
npm run video -- motion --video master.mp4 --cards cards.json --aspect 16:9 --out master-motion.mp4
npm run video -- variant --video master.mp4 --format 9:16 --timeline-fingerprint <hash> --out vertical.mp4
npm run video -- provenance --video master.mp4 --receipt-ids receipt-ids.json --out provenance.json
npm run video -- c2pa --video master.mp4 --manifest c2pa-signing-manifest.json --out master-signed.mp4
```

O reframe padrão é `fit-pad`, que preserva o frame inteiro. `center-crop` e a variante `1:1` exigem aprovação explícita. O manifesto JSON de proveniência verifica o hash do master e a cadeia declarada de recibos, mas não se apresenta como assinatura C2PA. A assinatura opcional é um passo separado: requer `c2patool` e um signing manifest configurado pelo operador, só publica após `c2patool --json` confirmar o manifesto ativo e cria um receipt próprio sem registrar caminhos de chaves.

## Provedores e credenciais

O registry declara operações, autenticação, reconcile, aspectos, estabilidade e último health probe. Narração usa Google Vids; música usa Flow Music. Omni permanece o gerador audiovisual principal. Uma UI autenticada não é tratada como contrato estável de API. Cookies/tokens permanecem fora de estado, recibos e telemetria.

## Armazenamento e proveniência

O primeiro estágio de storage é somente `report/plan`. Relocação segura usa `copy → SHA-256 → verify → manifest`; receipts históricos continuam imutáveis e o resolver procura o original antes do manifesto. Não existe prune automático. Um prune futuro continua exigindo plano revisado, confirmação humana e quarentena/lixeira.

## Rollout

O executor legado permanece como padrão de compatibilidade. `shadow` cria o journal e compara equivalência; `journal` só é elegível sem divergência. O wrapper legado não será removido até a equivalência operacional estar comprovada.

## Validação provider-free

```powershell
npm run check
npm run test:coverage
```

O CI roda Windows e Linux com credenciais vazias. Fixtures usam doubles e mídia sintética; a suíte nunca consome cookies, cotas ou chamadas reais.
