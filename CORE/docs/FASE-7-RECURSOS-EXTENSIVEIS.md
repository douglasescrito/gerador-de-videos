# Fase 7 — Recursos extensíveis

> Registro de arquitetura de uma etapa anterior. Não descreve, por si só, o estado atual desta distribuição. Use [Instalação Windows](INSTALACAO-WINDOWS.md), [guia do app](GERADOR-APP.md) e [contrato atual](AGENT-CONTRACT.md). Resultados e acervos privados daquela etapa não acompanham o pacote.

- O painel Recursos deriva do provider registry canônico no desktop; `pending`, `blocked` e capability sem dependência de entrega aparecem bloqueados.
- Receita Mestre declara intents (`video.generate.*`, `narration.generate.*`, `music.generate.timeline`, `media.compose.local`), resolvidas pelo registry. Mais de uma capability ativa para o mesmo intent falha fechado.
- `capability-lifecycle.mjs` implementa candidato → conformance/replay/prova live → ativação humana com TTL. Expiração remove somente a admissão nova.
- Google Vids multi-voz estava `pending` nesta etapa; a disponibilidade atual depende do registry e das provas válidas da instalação. O planner, adapter comum e replay provider-free exigem WAV/recibo distinto por segmento, concatenação, alinhamento Whisper global e reconciliação sem resubmissão.
- O preflight só libera multi-voz quando uma ativação válida, humana e não expirada é injetada; não há fallback silencioso.
- Compare CPU e GPU usando arquivos sintéticos iguais, integridade do resultado e tempos de hash/probe/encode separados. Consulte a configuração local de Whisper; não deduza CUDA pela presença de uma placa NVIDIA.

Os testes locais usam dublês e replay. A promoção de uma capacidade remota
depende de evidência válida e da decisão prevista no contrato atual.
