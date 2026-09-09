# Seu primeiro projeto no Gerador de Vídeos

O gerador combina criação por IA com animação e montagem locais. Você pode criar
clipes, comerciais, apresentações de imagens, filmes narrados e motion graphics.
Esta cópia começa sem produções, marcas, pessoas ou contas do autor: seus projetos
serão criados na sua instalação.

## Instalar e abrir

1. Obtenha acesso ao repositório privado com sua própria conta GitHub. Clone o
   projeto para uma pasta sua, como GERADOR DE VIDEOS na Área de Trabalho.
2. Siga a [instalação Windows](CORE/docs/INSTALACAO-WINDOWS.md) para preparar
   Node, Chrome e FFmpeg. Execute INSTALAR.ps1 na raiz do projeto.
3. Abra INICIAR.cmd. Se houver falha, use DIAGNOSTICAR.cmd e confira o requisito
   indicado. Não abra várias cópias do Studio na mesma porta.
4. Para gerar conteúdo em serviços externos, execute ATIVAR-CONTAS.cmd e faça
   login nas suas contas. Você não precisa receber cookies de outra pessoa.

As sessões e o Credential Manager pertencem ao usuário Windows. Cada filho deve
usar seu próprio usuário Windows para manter contas e dados separados. O perfil
Chrome permite renovar a sessão enquanto o serviço a aceitar; um novo login pode
ser necessário quando a sessão expirar. Os detalhes estão no guia de instalação.

## Escolher o caminho da produção

| Você quer | Caminho |
| --- | --- |
| Animar formas, luzes, partículas ou suas imagens | Presets e composição local com Three.js |
| Gerar uma cena a partir de uma descrição | Geração Omni com sua sessão Google |
| Criar uma apresentação narrada | Studio com Google Vids, Whisper, animação e mixagem |
| Criar uma trilha por IA | Flow Music com sua sessão própria |
| Montar e finalizar materiais existentes | Operações locais de montagem, áudio e acabamento |

Three.js desenha a cena. Playwright executa a animação no Chrome headless e
captura os frames; FFmpeg codifica o vídeo e trabalha a montagem e o áudio.
Essas ferramentas são parte do motor. Não é preciso copiá-las manualmente para
cada produção. Render local com formas e assets próprios não exige login Google.

O modo raw entrega a geração original, com o prompt literal. Use Studio quando
quiser narração, música, animação, montagem, legendas ou acabamento. Declare essas
etapas no pedido; elas não devem aparecer silenciosamente numa geração raw.

## Fazer um primeiro motion

Comece por um preset do [Three Design Studio](CORE/docs/THREE-DESIGN-STUDIO.md).
Defina formato, duração, cores e movimentos. Use formas geométricas primeiro;
depois, forneça suas próprias imagens para uma galeria. Faça uma prévia local
antes de aumentar resolução ou quantidade de elementos.

Um pedido pode ser: “Crie uma apresentação de 30 segundos com estas imagens,
movimento espacial suave, contornos luminosos discretos e sem texto sobreposto.
Use efeitos sonoros suaves nos movimentos e preserve meus arquivos originais.”

Se desejar narração e trilha, forneça o texto e peça essas etapas explicitamente.
Os efeitos sonoros precisam existir como áudio e ser sincronizados na montagem;
mover um objeto em Three.js não produz som automaticamente.

## Produzir com voz

Faça uma cópia de uma [receita reutilizável](CORE/recipes/LEIA-ME.md). Substitua
os textos de demonstração, caminhos de assets e identificadores de documento
pelos seus. Não execute campos COLE AQUI ou USER_DOCUMENT_ID como se estivessem
prontos. Escolha uma voz disponível na sua sessão Google Vids.

O [fluxo audio-first](CORE/templates/audio-first-multi-capitulos/README.md)
começa pela voz real. Whisper mede as palavras, e as cenas seguem esses tempos.
Na montagem, voz, música e efeitos ocupam pistas próprias. Ouça a clareza da fala,
a intensidade dos efeitos e o encerramento. Texto na tela só entra quando pedido;
ele não substitui uma narração ausente.

O plano mostra as etapas e dependências. A execução segue o workflow declarado:
production-once continua até a entrega, enquanto fluxos antigos podem pedir
revisão de draft. Não há confirmação de gasto no projeto. O acesso aos serviços
e suas capacidades depende das contas usadas; a geração não tem resultado
estético garantido.

## Conferir a entrega e retomar falhas

Abra o MP4 final, veja a peça inteira e ouça o áudio. Confira duração, imagens,
falas, sincronia, texto solicitado e arremate. A checagem técnica ajuda a detectar
problemas de arquivo, mas não garante intenção visual, fidelidade de marca ou
qualidade artística. As condições de uso dos assets e serviços continuam sendo
responsabilidade de quem os fornece; gerar música não garante exclusividade.

Produções ficam em CORE/outputs por coleção. Originais ficam em videos-soltos,
masters em videos-unidos, recibos em receitas e estado em metadados. O recibo
registra a operação; ele não substitui assistir ao master físico.

Se houver interrupção, guarde o estado e peça para consultar status e reconciliar
a tentativa existente. Não inicie outra geração só porque a primeira demorou.
Retomar depende do estado e dos artefatos disponíveis; uma chamada ambígua pode
exigir investigação antes de continuar.

## Atualizar e desenvolver

Feche o app antes de executar ATUALIZAR.ps1. Ele exige clone Git com upstream e
código sem alterações locais, usa fast-forward e não limpa seu acervo. Preserve
seu trabalho antes de integrar uma atualização. ZIP permite instalar, mas não
oferece esse fluxo de atualização por Git.

Não versione cookies, perfis, bancos privados, fotos pessoais, produções ou
recibos. Para desenvolver recursos, consulte o [README do CORE](CORE/README.md),
o [índice técnico](CORE/docs/LEIA-ME.md) e a
[skill operacional](.agents/skills/gerador-de-videos/SKILL.md).
