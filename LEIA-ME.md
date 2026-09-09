# GERADOR DE VIDEOS

Estúdio local para gerar, animar, montar e finalizar vídeos. Inclui o CLI, app,
receitas genéricas, ferramentas de áudio, motor de motion e orientação para agentes.
Esta edição não contém contas, marcas, referências pessoais, produções anteriores
nem acervo de terceiros.

O [índice de documentação](CORE/docs/LEIA-ME.md) reúne os guias de operação e
desenvolvimento desta edição.

O [guia de primeiro uso](GUIA-DE-USO.md) explica os caminhos de produção e como
conferir suas primeiras entregas.

## Começar no Windows

1. Clone o repositório para uma pasta sua, por exemplo GERADOR DE VIDEOS na Área
   de Trabalho. Cada pessoa deve usar sua própria conta Windows e seus logins.
2. Siga [Instalação no Windows](CORE/docs/INSTALACAO-WINDOWS.md) para preparar
   Node, Chrome e FFmpeg. Na raiz, execute `INSTALAR.ps1` pelo PowerShell.
3. Abra `INICIAR.cmd`. `DIAGNOSTICAR.cmd` ajuda a identificar requisitos ausentes.
4. Comece pelos presets locais Three.js: eles não exigem login nem imagem pessoal.
5. Para IA externa, use `ATIVAR-CONTAS.cmd` e entre com suas próprias contas nas
   janelas abertas. Não copie cookies ou perfis de outra pessoa.

## Criar

O modo raw preserva a geração original. O modo Studio adiciona as etapas que
você solicitar: narração, música, montagem, sincronismo, legendas e acabamento.
As capacidades externas dependem do acesso da sua conta ao provedor.

Leia [Three.js e produção motion](CORE/docs/THREE-DESIGN-STUDIO.md) para luzes,
bloom, animações, partículas, componentes, keyframes e galerias de imagens.
As bibliotecas são instaladas pelo lockfile; não é necessário copiá-las à mão.

O [visualizador de áudio para Windows](CORE/docs/AUDIO-WAVE-STUDIO.md) permite
ouvir suas pistas, ajustar os ganhos e exportar pelo mixer do Studio.

O [guia do app](CORE/docs/GERADOR-APP.md) explica criação guiada, editor,
acompanhamento e exportação. O [guia dos motores locais](CORE/docs/MOTORES-LOCAIS.md)
reúne exemplos neutros e limites de cada renderer. Para desenhar novas animações,
consulte [direção de motion](CORE/docs/DIRECAO-MOTION-ORGANICO.md); para testar
e evoluir o código, veja [provas do motor](CORE/docs/PREPARAR-PROVAS-DO-MOTOR.md).

Para narração medida e cenas em sequência, use o
[modelo audio-first em capítulos](CORE/templates/audio-first-multi-capitulos/README.md).
Os [plugins Wasm](CORE/plugins/README.md) incluem fontes para desenvolvimento;
a integração desses módulos com o app ainda é trabalho futuro.
O [mapa de arquitetura](CORE/docs/ARCHITECTURE-BOUNDARIES.md) e as
[decisões de desenho](CORE/docs/adr/) explicam os limites e a evolução do motor.
Os [exemplos de Receita Mestre](CORE/recipes/EXEMPLOS-TECNICOS.md) mostram como
combinar referências, áudio, pós-produção e filmes segmentados. Eles exigem
preenchimento dos próprios assets e autorizações antes de executar.

A [skill operacional](.agents/skills/gerador-de-videos/SKILL.md) orienta o agente
no uso do motor. O [AGENTS.md](AGENTS.md) mantém o contrato da operação. Você
também pode operar o CLI diretamente em CORE, consultando a ajuda dos comandos.

Produções novas ficam em `CORE/outputs/<colecao>/`. Masters ficam em
`videos-unidos`, originais em `videos-soltos` e recibos em `receitas`.
Se uma execução for interrompida, retome pelo estado existente antes de gerar outra.

## Atualizar e preservar seu trabalho

Use `ATUALIZAR.ps1`. Ele recusa alterações locais de código e usa atualização
fast-forward; não executa reset nem apaga seu acervo. Mantenha suas configurações,
fotos, outputs, sessões e conhecimento privado fora do versionamento.

O cofre e os perfis de sessão pertencem ao usuário Windows. Se dois usuários
compartilharem o mesmo login Windows, também compartilharão esses dados locais.
