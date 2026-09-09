# Exemplos técnicos de Receita Mestre

Estes arquivos demonstram módulos e contratos do motor. Não são produções
prontas, não contêm mídia e não concedem direitos:

| Exemplo | Estrutura preservada |
| --- | --- |
| [2.5B](golden-30s.receita-v2.5b.json) | Três planos, referência de pessoa, narração, Whisper, música, legendas e mixagem |
| [2.5C](golden-30s.receita-v2.5c.json) | Referências, transições, HTML, logo, pós-produção, QA, entrega e variantes |
| [2.5D](golden-180s.receita-v2.5d.json) | Filme de 18 cenas, execução segmentada, áudio, gráficos e pós-produção |

Os caminhos apontam para assets que você deverá fornecer. Tamanho `1`, hashes
zerados e `SUBSTITUA-PELO-SEU-DOCUMENTO` são marcadores sem valor operacional.
Todos os direitos estão `unknown`; variantes permanecem sem aprovação. O
exemplo 2.5C inclui somente a variante vertical sem recorte. Para adicionar
`1:1` com `center-crop`, o operador precisa aprovar esse enquadramento
explicitamente; `approved: false` nesse recorte reprova a validação. O
preflight deve bloquear esses arquivos até que o operador registre os próprios
assets, hashes, direitos, escopos, autorização e documento Vids. Não basta trocar
`unknown` por `allowed` sem o vínculo de autorização correspondente.

Escolha vozes e backend Whisper suportados na sua instalação; os exemplos
representam contratos e não instalam ferramentas adicionais. Tempos de voz e
música permanecem `planned-not-measured`. No exemplo 2.5C, os 708 frames
representam 29,5 s a 24 fps: a sobreposição de 12 frames reduz os três planos
de 240 frames. O nome histórico do arquivo não é a duração final exata.

Use `npm run video -- recipe --help` para inspecionar, validar e planejar. Faça
uma cópia própria antes de editar. Consulte o [contrato do CLI](../docs/AGENT-CONTRACT.md)
e o [modelo em capítulos](../templates/audio-first-multi-capitulos/README.md).
Nenhum teste estrutural equivale a gerar e validar um master com áudio real.
