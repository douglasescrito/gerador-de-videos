# Gerador de Vídeos

Estúdio local para criar vídeo do começo ao fim: roteiro, narração, imagem,
animação, trilha, montagem e acabamento. Roda na sua máquina, com as suas contas
e as suas produções.

Esta cópia começa vazia. Não vem com trabalho, marca, cliente, pessoa ou sessão
de ninguém.

## Por onde começar

| Se você quer | Leia |
| --- | --- |
| instalar e abrir pela primeira vez | [LEIA-ME.md](LEIA-ME.md) |
| entender o fluxo e fazer o primeiro vídeo | [GUIA-DE-USO.md](GUIA-DE-USO.md) |
| preparar Windows, Node, Chrome e FFmpeg | [CORE/docs/INSTALACAO-WINDOWS.md](CORE/docs/INSTALACAO-WINDOWS.md) |
| ver todos os guias técnicos | [CORE/docs/LEIA-ME.md](CORE/docs/LEIA-ME.md) |
| trabalhar com um agente de IA neste projeto | [AGENTS.md](AGENTS.md) |

No Windows, o caminho curto é: `INSTALAR.ps1` pelo PowerShell, depois
`INICIAR.cmd`. Se algo faltar, `DIAGNOSTICAR.cmd` diz o quê.

## O que tem aqui

```text
CORE/
  app/         painel do acervo e do gerador, no navegador
  lib/         o motor: pipeline de mídia, execução governada, conhecimento
  scripts/     o CLI e as ferramentas de produção
  recipes/     modelos comerciais prontos para preencher e gerar
  docs/        manuais de produção, guias de direção e catálogos gerados
  test/        a suíte que roda sem chamar nenhum provedor
  schemas/     os contratos de cada formato
  assets/      efeitos sonoros e fontes com licença declarada
```

Duas formas de trabalhar, e elas conversam: o CLI, que faz tudo e é o caminho
principal, e o painel no navegador, para navegar, comparar e ouvir o que já foi
produzido.

## Como as coisas funcionam

- **A voz manda no tempo.** A narração é medida palavra por palavra, e imagem,
  efeito e trilha obedecem a essa medida.
- **Nada de legenda por cima.** Quando há texto na tela, ele nasce dentro do
  próprio vídeo.
- **Todo arquivo entregue tem recibo.** Origem, parâmetros e hash ficam
  registrados, e nada é sobrescrito em silêncio.
- **Nenhuma chamada paga acontece sozinha.** Ferramenta de diagnóstico só
  relata; repetir ou corrigir é decisão sua.
- **A suíte de testes nunca chama provedor.** Ela usa mídia sintética e dublês.

## Contas e privacidade

Cada pessoa usa a própria conta e o próprio cofre de credenciais do Windows.
`ATIVAR-CONTAS.cmd` abre as janelas de login. Não copie cookies, perfis ou
credenciais de outra pessoa.

Direitos, licenças e o que não vem junto: [DIREITOS-E-COMPARTILHAMENTO.md](DIREITOS-E-COMPARTILHAMENTO.md).
