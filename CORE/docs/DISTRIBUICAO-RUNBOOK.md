# Distribuição, atualização e recuperação no Windows

Esta edição distribui código-fonte e recursos reutilizáveis. O lançador abre o
app Node local; não é um instalador NSIS. O roteiro histórico de build Tauri não
se aplica: a árvore app/src-tauri e o package.json daquele app não estão na
versão atual. Rust não é requisito para usar o gerador; é ferramenta opcional
para recompilar os [plugins Wasm](PLUGIN-RUNTIME.md).

## Instalar uma cópia própria

1. Obtenha acesso ao repositório privado pela sua própria conta GitHub.
2. Clone para uma pasta sua, como GERADOR DE VIDEOS na Área de Trabalho. Um ZIP
   também permite instalar, mas o atualizador exige um clone Git com upstream.
3. Prepare os requisitos da [instalação Windows](INSTALACAO-WINDOWS.md): Node,
   Chrome e FFmpeg/FFprobe. O Playwright controla o Chrome headless do renderer.
4. Na raiz, execute `./INSTALAR.ps1 -CheckOnly` e então `./INSTALAR.ps1`.
   Para Whisper local, use `./INSTALAR.ps1 -WithWhisper`, com Python 3.11.
5. Abra INICIAR.cmd. Configure suas contas por ATIVAR-CONTAS.cmd somente quando
   for usar provedores externos. Login é pessoal, fora do projeto.

O instalador usa npm ci com o lockfile, recria os efeitos sonoros técnicos e
grava caminhos da máquina em LOCALAPPDATA. Não copia perfis, cookies, imagens
pessoais, produções anteriores nem bancos privados. Downloads de dependências
e do modelo Whisper não são chamadas de geração.

## Conferir uma versão

Execute em CORE:

```powershell
npm run docs:check
npm run recipes:check
npm test
```

Os testes usam fixtures e provedores simulados; alguns precisam de Chrome e
FFmpeg para gerar artefatos sintéticos. Leia o resultado completo e registre
falhas, skips e dependências ausentes. Não substitua um teste local por uma
produção remota sem um pedido explícito de produção.

A [verificação no GitHub](../../.github/workflows/provider-free-ci.yml) executa
esses três comandos em Windows e Linux, instala o lockfile do CORE e prepara
Chrome, FFmpeg e os efeitos sonoros sintetizados localmente. O app Node usa as
dependências do CORE; não há uma segunda instalação em app. O workflow não
recebe cookies nem segredos e não publica vídeos ou releases. Os executores e
pacotes de sistema do CI podem mudar; a matriz não é uma atestação do ambiente
determinístico de uma produção. Recursos exclusivos do Windows e dependências
opcionais podem aparecer como skips em outro ambiente.

Até existir uma execução concluída no repositório de destino, o workflow é
configuração preparada, sem comprovação de execução remota. A validação local
também não comprova o job Linux.

Confirme a abertura do app, catálogo próprio, um render local e o MP4 físico.
Valide também num novo usuário Windows ou numa máquina diferente antes de
declarar portabilidade completa. Os testes realizados no computador do autor
não comprovam essa última etapa.

## Atualizar sem perder trabalho

Feche o app e execute ATUALIZAR.ps1 na raiz. O script exige clone Git válido,
upstream configurado e árvore sem mudanças de código; usa pull --ff-only e
executa o instalador depois. Não faz reset nem limpa arquivos. Use -CheckOnly
para conferir apenas as condições locais, sem buscar ou instalar atualização.

Se você desenvolveu recursos próprios, registre ou preserve suas alterações
antes de atualizar. Divergência de branches exige integração deliberada. Uma
falha de instalação após o pull pode deixar o código atualizado e dependências
incompletas; corrija o requisito e execute INSTALAR.ps1 novamente.

O teste distribution-update usa repositórios Git temporários e o script real de
atualização para verificar CheckOnly, alterações rastreadas e não rastreadas,
fast-forward, divergência, upstream ausente e falha de instalação. O instalador
é simulado nesse ensaio. Ele não prova autenticação no GitHub nem downloads de
dependências numa máquina nova.

## Recuperar e preparar releases

Preserve a versão anterior em uma pasta separada antes de substituir um ambiente
em uso. Em falha, guarde os logs de CORE/diagnosticos e use DIAGNOSTICAR.cmd.
Reabra uma cópia anterior validada depois de fechar o app atual; duas cópias não
devem disputar a mesma porta. Alterações de schema exigem verificar compatibilidade
do estado, não apenas trocar o código.

Nunca apague outputs, recibos, ledgers, Knowledge Core, sessões Google ou o cofre
durante recuperação. Backups do Knowledge Core usam seus comandos governados e
permanecem fora do Git; não copie um banco aberto como se fosse backup validado.

Para distribuir uma nova versão, monte uma cópia limpa com arquivos revisados,
lockfile, fontes e licenças. Confira segredos, mídia pessoal e recibos antes de
versionar. Uma lista ignore não remove arquivos já rastreados nem limpa histórico.
O primeiro compartilhamento deve usar histórico Git novo e repositório privado.
Acervo de terceiros não entra na distribuição. Se um dia entrar, precisa de
escopo escolhido arquivo a arquivo e de limites de uso declarados por escrito.

Build de executável, assinatura Authenticode, SBOM de binários e atualização
remota automática são frentes de desenvolvimento separadas. Não estão implícitas
no clone nem comprovadas pelo funcionamento do lançador atual.
