---
name: gerador-de-videos
description: Criar, montar e finalizar vídeos, motion graphics, narração e trilhas no Gerador de Vídeos local; operar seus comandos, receitas e sessões autenticadas.
---

# Gerador de Vídeos — Studio Audiovisual

Use o motor, CLI e app existentes. Resolva o projeto a partir desta skill e
execute comandos em `CORE/`. Leia `CORE/docs/AGENT-CONTRACT.md` antes de invocar
o CLI: ele é gerado do contrato vigente e prevalece sobre exemplos desatualizados.

## Escolher o fluxo

- `raw`: prompt literal e arquivo original do provedor, sem montagem silenciosa.
- `studio`: composição explícita, narração, música, sincronismo, acabamento e QA.
- Motion local: Three.js, HyperFrames ou Remotion pelo comando `render` existente.
  As dependências vêm do lockfile; não criar outro motor, servidor ou executor.

Antes de gerar, execute `npm run doctor`. Para geração externa, consulte também
`npm run session -- status`. Ausência de sessão não impede o render local.
Consulte `npm run video -- <comando> --help` para as flags do recurso escolhido.

Para uma produção, explicite cenas, duração, pessoas, referências, fala/off,
texto em tela e trilha antes de executar. Não invente marca, personagem, voz
ou referência pessoal. Os exemplos são neutros; não contêm fotos nem contas.

## Regras de execução

- Use somente referências fornecidas e autorizadas pelo usuário. Cenas sem
  pessoa não herdam sua foto; presença visual e narração off são decisões distintas.
- Assets, pessoas, clientes e conhecimento privado pertencem ao Knowledge Core
  existente, com direitos e escopo. Selecionar uma imagem não concede autorização.
- Imagens/vídeos externos ad hoc exigem `--confirm-provider-input true` na
  invocação, ou a autorização congelada aceita pelo executor da produção.
- Não há `--confirm-paid` nem autenticação por GEMINI_API_KEY. Não reintroduzi-las.
- `production-once` segue até a entrega com a autorização congelada; `resume`
  reutiliza plano e journal. Estado ambíguo exige reconciliação, nunca reenvio cego.
- Não consumir nova cota por decisão estética. Correções objetivas seguem os
  limites do executor existente e preservam as tentativas aceitas.
- Preserve originais. Valide o arquivo físico, streams e recibo antes de entregar.

## Recursos por tarefa

- [Produção e validação](references/production-contract.md): cenas, montagem e entrega.
- [Comandos e sessões](references/cli-commands.md): entrada correta e retomada.
- [Áudio e sincronismo](references/audio-and-music.md): Vids, Flow Music, Whisper e SFX.
- [Receitas e motion](references/recipes-and-schemas.md): schemas, presets e autoria.
- `CORE/docs/THREE-DESIGN-STUDIO.md`: Three.js, GSAP, postprocessing, Fiber/Drei,
  Theatre, partículas, galeria de imagens, qualidade e fluxo de produção.

Cookies ficam no Credential Manager do próprio usuário Windows; sessões,
configuração e conhecimento privado ficam fora do Git. Faça login manual pelo
setup. Nunca peça cookies no chat nem copie os de outra instalação.

Entregue um resumo curto, o MP4 final e o recibo principal. Não declare sucesso
somente por um JSON ou pela presença de uma sessão. Publicação no Drive é uma
etapa explícita e separada, com dry-run e `--confirm-drive-write true`.
