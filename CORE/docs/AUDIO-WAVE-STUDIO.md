# Visualizador de áudio no Windows

Abra `CORE/AudioWaveStudio.bat` e escolha dois arquivos seus: uma narração e uma
trilha. O programa mede a duração com FFprobe e desenha as ondas com FFmpeg.
Não requer login, não chama um provedor e não acompanha áudio de produções anteriores.
Requer Windows PowerShell com WPF, Node, FFmpeg e as dependências do Studio instaladas.

Reproduzir, pausar, buscar na onda, ajustar ganhos, silenciar e ouvir uma pista
isolada permanecem disponíveis. A reprodução é uma prévia aproximada de dois
players WPF: não é uma prova de sincronismo exato ou de loudness. Os players
limitam seu volume; confira o WAV exportado para avaliar o resultado do mixer.

Exportar chama o comando `mix --mode studio` do CLI existente, com os ganhos,
mute/solo e ganho geral selecionados. O destino padrão é
`CORE/outputs/audio-wave-studio/audios-unidos`. Cada exportação ganha um nome
único e preserva os arquivos anteriores. O mixer produz o WAV e seu recibo;
o visualizador confere o código de saída e reabre o áudio com FFprobe antes de
anunciar sucesso. Não aplica fade nem cria MP3 automaticamente.

A onda verde aparece após uma exportação e representa aquele último WAV.
Mudar um slider não redesenha essa onda antes da próxima exportação. As imagens
de inspeção ficam em `CORE/diagnosticos/audio-wave-*` e não entram no Git.

Também é possível fornecer os caminhos sem usar os seletores, a partir de `CORE`:

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File scripts/AudioWaveStudio.ps1 -Voice "C:\meus-audios\voz.wav" -Music "C:\meus-audios\trilha.wav" -OutputDirectory "C:\meus-audios\masters"
```

Acrescente `-CheckOnly` para validar os arquivos e medir a duração sem abrir a
janela, gerar imagens ou exportar áudio. Os dois caminhos são obrigatórios nesse
modo. Arquivos inválidos encerram com erro.

O atalho `CORE/Acervo.vbs` usa a mesma inicialização de `INICIAR.cmd`, com a
verificação da cópia do Studio que ocupa a porta. Ele não inicia outro servidor
por conta própria. Em falha, consulte `DIAGNOSTICAR.cmd` na pasta principal.
