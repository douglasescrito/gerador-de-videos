# Documentação do Gerador de Vídeos

Esta edição reúne instruções de uso e recursos técnicos sem o acervo, as contas
ou o histórico privado do autor. Comece pelo guia principal na raiz do projeto.

| Necessidade | Documento |
| --- | --- |
| Instalar e ativar suas contas | [Instalação Windows](INSTALACAO-WINDOWS.md) |
| Atualizar e preparar versões | [Distribuição e recuperação](DISTRIBUICAO-RUNBOOK.md) |
| Usar o aplicativo | [Guia do app](GERADOR-APP.md) |
| Operar por comandos | [Contrato do CLI](AGENT-CONTRACT.md) |
| Conferir opções e capacidades | [Comandos](COMMAND-STATUS.md) e [capacidades](CAPABILITIES.md) |
| Animar com Three.js | [Three Design Studio](THREE-DESIGN-STUDIO.md) e [WebGL](STUDIO-WEBGL.md) |
| Escolher um renderer local | [Motores locais](MOTORES-LOCAIS.md) |
| Trabalhar voz e música | [Visualizador de áudio](AUDIO-WAVE-STUDIO.md) e [capítulos audio-first](../templates/audio-first-multi-capitulos/README.md) |
| Preparar uma receita | [Receitas reutilizáveis](../recipes/LEIA-ME.md) e [pós-produção](POS-PRODUCAO-RECEITA.md) |
| Configurar direção por projeto | [Diretores de marketing](DIRETORES-DE-MARKETING.md) |
| Migrar estados antigos | [Rollout do executor](guias/EXECUTOR-ROLLOUT.md) |
| Entregar uma coleção no Drive | [Entrega no Drive](guias/ENTREGA-DIARIA-DRIVE.md) |
| Criar direção textual de produto | [Texto pelo AI Studio](TEXTO-AI-STUDIO.md) |
| Desenvolver o motor | [Limites de arquitetura](ARCHITECTURE-BOUNDARIES.md), [ADRs](adr/) e [plugins Wasm](PLUGIN-RUNTIME.md) |

Os catálogos de [estilos](STYLE-CATALOG.md), [técnicas](TECHNIQUE-CATALOG.md),
[packs](KNOWLEDGE-PACKS.md) e [ontologia](AUDIOVISUAL-ONTOLOGY.md) são gerados.
Use npm run docs:check em CORE para conferir a sincronização com suas fontes.
Um catálogo não concede direitos de uso nem comprova uma capacidade remota.

Documentos de fases e ADRs preservam decisões históricas. Leia suas notas de
contexto: uma conclusão de uma fase anterior não prova que a configuração atual
foi testada em outra máquina. A disponibilidade observada do runtime e os testes
da versão instalada têm precedência sobre contagens e promessas históricas.
