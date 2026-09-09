# Fase 8 — Limpeza final

> Registro de arquitetura de uma etapa anterior. Não descreve, por si só, o estado atual desta distribuição. Use [Instalação Windows](INSTALACAO-WINDOWS.md), [guia do app](GERADOR-APP.md) e [contrato atual](AGENT-CONTRACT.md). Resultados e acervos privados daquela etapa não acompanham o pacote.

- A fase histórica encerrou uma superfície Express e concentrou o desktop em Tauri/Rust. Isso não se aplica como descrição do lançador atual, que abre o app Node local existente.
- O cache ativo permanece `%LOCALAPPDATA%\GeradorDeVideos\Acervo\derived-cache\v1`; a migração foi não destrutiva e os caches-fontes legados não foram apagados.
- O dispatcher de Receita Mestre foi extraído para `lib/cli/recipe-command-handler.mjs`; direção, execução, schedules e capabilities já vivem em módulos de caso de uso.
- Componentes mortos `LooseArchive` e `AcervoNav`, supervisor/servidor/smoke Express e testes exclusivos da superfície aposentada foram removidos depois da prova Tauri.
- O inventário derivado do filesystem classifica documentos com schema por papel e vincula decisões a hashes. Repita esse levantamento na versão que estiver preparando.
- Recuperação preserva originais, recibos e stores. Esta distribuição começa com novo histórico Git; o histórico privado do autor não é mecanismo de recuperação disponível aos destinatários.
- O encerramento de uma etapa exige testes de núcleo, app, Rust, typecheck, lint, build UI e contratos gerados aplicáveis à superfície selecionada. Registre skips, ignored e limitações reais; contagens históricas não provam uma instalação nova.
- O contrato desktop-runtime@2 inventaria arquivos, recusa links e extras, registra raiz SHA-256 e restringe fallback de PATH a debug. Uma reconstrução precisa gerar suas próprias evidências; inventários binários históricos não acompanham esta cópia.

Use este registro como roteiro de verificação e compatibilidade histórica.
A prontidão da edição atual deve ser demonstrada pelo seu build e seus testes.
