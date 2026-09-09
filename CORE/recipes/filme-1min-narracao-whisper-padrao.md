# Modelo de filme narrado em seis cenas

O [JSON de referência](filme-1min-narracao-whisper-padrao.receita.json) contém seis
janelas de dez segundos. Seus textos são campos a preencher, não uma produção
pronta. Não há foto, logo, locução, trilha ou conta pré-configurada.

1. Faça uma cópia para sua produção. Edite id, collection, roteiro completo,
   textos dos seis blocos e direção visual de cada cena. O texto completo deve
   corresponder aos blocos; não gere voz com os marcadores COLE AQUI.
2. Configure o documento Vids da sua conta no lugar de USER_DOCUMENT_ID. A voz
   deste exemplo é Jett; confira as vozes disponíveis na sua sessão.
3. Em CORE, consulte a ajuda dos comandos tts e music para produzir voz Google
   Vids e trilha Flow Music explicitamente. Este modelo não concede permissão
   para substituir o provedor de narração por outra rota. O campo legado de
   fallback manual não constitui autorização de execução alternativa.
4. Meça a voz real com align e o roteiro aprovado. Use apenas timestamps
   aceitos; não invente tempos para fazer a fala caber. Redimensione seu roteiro
   ou a timeline quando necessário e verifique novamente a soma das cenas.
5. Prepare os visuais a partir do alinhamento conforme o
   [fluxo audio-first](../templates/audio-first-multi-capitulos/README.md).
   Cenas sem pessoa são text_to_video, sem referência de rosto. Este exemplo
   não contém overlays; textos gráficos só entram quando explicitamente pedidos.
6. Monte, mixe e valide pelo Studio. Preserve a voz medida e o desfecho da música,
   mantenha originais e confira streams, duração e sincronismo no MP4 final.

Para inspecionar a compilação, sem escrever estado nem chamar provedor, execute
em CORE:

    npm run video -- receita --file recipes/filme-1min-narracao-whisper-padrao.receita.json --format json

Esse comando não entrega vídeo e não confirma que os placeholders foram
substituídos. O modelo declara revisão humana; não trate seus campos de workflow
como prova de execução automática. O caminho canônico de novas produções e os
gates atuais estão no [contrato do CLI](../docs/AGENT-CONTRACT.md).
