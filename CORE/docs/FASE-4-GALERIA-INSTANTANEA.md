# Fase 4 — Galeria instantânea

> Registro de arquitetura de uma etapa anterior. Não descreve, por si só, o estado atual desta distribuição. Use [Instalação Windows](INSTALACAO-WINDOWS.md), [guia do app](GERADOR-APP.md) e [contrato atual](AGENT-CONTRACT.md). Resultados e acervos privados daquela etapa não acompanham o pacote.

## Fonte única e derivados

- Na arquitetura desktop documentada nesta fase, o desenvolvimento consultava somente `CatalogService`/SQLite em Rust. O servidor Node/Express e seu segundo catálogo foram removidos na Fase 8.
- O cache ativo é `%LOCALAPPDATA%\GeradorDeVideos\Acervo\derived-cache\v1`, dividido em `thumbnails/`, `hover-proxies/` e `legacy-unbound/` sob a mesma raiz governada.
- O migrador foi desenhado para ser idempotente e não destrutivo, mantendo derivados antigos sem vínculo em uma área própria. A migração de um acervo deve ser validada na instalação do operador.
- `.cache/thumbnails`, `.cache/cinemateca-thumbs` e `.cache/proxies` não são mais destinos de escrita do desktop. Os arquivos-fonte antigos permanecem preservados para recuperação até a Fase 8.

## Backfill e caminho quente

- A ordem do resultado atual define a prioridade. A página inicial preaquece 24 miniaturas com concorrência 4 e somente os 2 primeiros proxies, um de cada vez.
- `hover-proxy@1` é um MP4 H.264/AAC, 480 px, faststart e janela de 12 s. Um proxy válido é sempre tentado antes do master; fallback para o master só ocorre após erro objetivo.
- O cartão virtualizado preserva proxy/demux montado enquanto permanece visível, pausando-o fora do hover. Ao sair da janela virtual, o React o desmonta.
- Miniaturas e vídeos têm caixa 16:9 reservada antes dos bytes, impedindo deslocamento de layout por mídia.

## Protocolo de medição

Separe busca SQLite de 10 mil e 100 mil itens, thumbnail quente (request → decode),
proxy quente (pointerenter → primeiro frame), cobertura de mídia e deslocamento
de layout. Use datasets sintéticos próprios e registre amostras, percentis,
hardware e versões. As metas históricas eram busca p95 abaixo de 150/500 ms,
thumbnail abaixo de 250 ms, proxy abaixo de 300 ms, cobertura acima de 95% e
CLS de mídia zero; não são resultados nem garantias desta instalação.

Cache ausente, disco frio e fallback de master ficam em coortes separadas.

## Provas preservadas

```powershell
cd CORE/app/src-tauri
cargo test --lib benchmarks_synthetic -- --ignored --nocapture --test-threads=1

```

O benchmark histórico de navegador dependia de um transporte transitório. Para
esta edição, verifique o frontend realmente utilizado antes de medir. Testes
Rust e métricas do frontend Tauri se aplicam àquela superfície, não comprovam
a galeria Node aberta pelo lançador atual.
