# Fase 6 — Direção explicável

> Registro de arquitetura de uma etapa anterior. Não descreve, por si só, o estado atual desta distribuição. Use [Instalação Windows](INSTALACAO-WINDOWS.md), [guia do app](GERADOR-APP.md) e [contrato atual](AGENT-CONTRACT.md). Resultados e acervos privados daquela etapa não acompanham o pacote.

- `creative-envelope@1` e `creative-fingerprint@1` congelam root, projeto, release, perfil, decisão e sete eixos criativos.
- A seleção é determinística, evita a combinação completa dentro da janela da release e registra eixos preservados/alterados e o motivo da variação.
- `creative-direction.json` só materializa com confirmação humana e hash esperado; não gera mídia nem promove Knowledge.
- A decisão materializada entra no `film-spec@2` e no `execution-plan@1`; o mesmo contexto+decisão produz o mesmo fingerprint.
- Likes ficam fora do fingerprint de planejamento e permanecem evidência sem autoridade.
- A tela do diretor mostra “Por que variou?” e a prateleira recente escopada.
