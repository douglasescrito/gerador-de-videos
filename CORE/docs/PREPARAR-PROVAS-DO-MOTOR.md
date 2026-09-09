# Preparar provas de evolução do motor

O auxiliar `prepare:live-gates` prepara um filme e um plano segmentado de vozes
usando receitas do próprio desenvolvedor. Ele não gera vídeo, voz ou música,
não lê cookies e não ativa a capability candidata.

Execute em CORE:

```powershell
npm run prepare:live-gates -- --film "caminho/filme.json" --multi-voice "caminho/vozes.json" --out "diagnosticos/prova-local" --media-out "outputs/prova-local/narracao" --prepared-at "2026-09-09T12:00:00Z"
```

Substitua receitas, pastas e data pelos valores da sua preparação. As receitas
seguem o contrato Receita Mestre; a de vozes precisa declarar os speakers e
seus blocos. A receita do filme passa pela compilação e pelo preflight existentes.
Direitos desconhecidos continuam bloqueando entradas de mídia.

A pasta de planos recebe cinco JSON: plano de vozes, capability candidata,
checklist de cenas, film spec e execution plan. A pasta de mídia é apenas um
destino futuro registrado no plano. A checklist informa castIds, referências,
texto e configuração musical da receita, sem presumir uma pessoa ou trilha.

Para conferir novamente a mesma preparação, repita os argumentos e a data.
Arquivos iguais são preservados; conteúdo divergente falha sem sobrescrever.
Para uma nova preparação, use outra pasta. Os JSON podem conter roteiros e
referências do usuário: permanecem fora do Git, em diagnosticos/outputs.

A prova real e a ativação humana com TTL são etapas posteriores do fluxo
existente. Um plano preparado não comprova WAV, sincronismo ou geração remota.

## Exercitar a compilação sem provedores

O corpus técnico distribuído contém 20 briefs fictícios, cobrindo os dez grupos
de planejamento, como motion, múltiplos clientes e direitos desconhecidos.
Não contém fotos, logos ou recibos de produção. Execute em CORE:

```powershell
node scripts/estudos/run-studio-golden-corpus.mjs --out diagnosticos/gold/relatorio.json
```

O auxiliar compila cada caso duas vezes e exige fingerprints iguais. Aceita
`--corpus caminho/casos.json` para um corpus próprio no mesmo schema, com
exatamente 20 casos e cobertura das dez categorias. Caminhos explícitos são
relativos ao diretório atual; sem `--corpus`, a fixture vem da instalação.
Cria a pasta de saída e recusa sobrescrever um relatório existente.

O relatório não executa os planos, não chama provedores e não promove
conhecimento. O campo `expected` documenta expectativas para revisão, não
asserções executadas: não comprova bloqueios reais de direitos, isolamento
de banco ou qualidade editorial. `humanVerdict` permanece `pending`.

## Finalizar a prova local de múltiplas vozes

Depois de obter os WAVs e recibos de cada segmento pelo fluxo autorizado,
o auxiliar abaixo reutiliza o plano multi-voz e os artefatos existentes:

```powershell
node scripts/estudos/finalize-live-multi-voice-proof.mjs diagnosticos/prova-local/multi-voice-plan.json diagnosticos/prova-local/replay.json
```

Use o nome real do plano preparado. O auxiliar valida seu fingerprint, os
hashes e as vozes dos recibos, concatena os WAVs na ordem do plano e usa o
Whisper local para medir as palavras no áudio completo, preservando sua
duração. Não gera novamente os segmentos nem envia conteúdo a provedores.
FFmpeg e Whisper precisam estar instalados e configurados nesta máquina.

Master, JSON de palavras e relatório exigem destinos distintos e ainda
inexistentes. Uma falha preserva os segmentos, o master já montado e os
diagnósticos; não repita cegamente nem apague os originais para tentar de novo.
Revise a causa e prepare outro destino pelo fluxo existente. Alinhamento
bloqueado não produz relatório de sucesso. Os testes distribuídos exercitam
FFmpeg com tons sintéticos e simulam o alinhador; não comprovam transcrição
de vozes reais nem disponibilidade do Whisper na máquina do usuário.

## Montar voz, música e efeitos fornecidos pelo usuário

Na distribuição limpa, o auxiliar de três pistas usa o mixer Studio existente:

```powershell
node scripts/estudos/render-3pistas-master.mjs --voice voz.wav --music trilha.wav --sfx efeitos.wav --duration 30 --out outputs/meu-estudo/master.wav
```

Ele gera WAV, MP3 de 320 kbps e um recibo para cada arquivo. A duração é explícita,
com encerramento por corte e sem fade. Os efeitos precisam estar sincronizados
no arquivo de entrada; o auxiliar não descobre sozinho os movimentos da cena.
Os ganhos opcionais --voice-gain, --music-gain e --sfx-gain usam escala linear
(padrões 1, 0.45 e 0.2). O ganho SFX deve ser positivo, dentro dos limites do
mixer. A trilha usa ducking do mixer para dar espaço à voz.

Destinos existentes são recusados. Os recibos registram entradas, parâmetros e
análise de loudness dos arquivos efetivos, sem promessa de qualidade editorial
automática. Esse auxiliar foi neutralizado para a distribuição; o script da
produção original permanece somente no workspace de origem.
