# Instalação independente no Windows

Esta é a orientação para a futura distribuição limpa. A pasta de desenvolvimento
original ainda contém material pessoal e não deve ser copiada nem publicada inteira.
A instalação em um novo usuário Windows ainda está pendente de validação.

## Preparar o computador

Use um usuário Windows próprio. O cofre, as sessões do navegador e o Knowledge
Core pertencem a esse usuário. Duas pastas no mesmo usuário não isolam contas.

Instale Node.js com npm (mínimo 22; a verificação local usou 24.15.0), Google
Chrome e FFmpeg com ffprobe disponíveis no PATH. Git é necessário para clonar e
atualizar. Não copie node_modules ou executáveis da máquina de outra pessoa.
Se utilizar Chrome em uma localização diferente, configure CHROME_PATH com o
caminho absoluto do executável antes da instalação.

Após a disponibilização do repositório privado, clone-o para a pasta desejada,
por exemplo, GERADOR DE VIDEOS na Área de Trabalho. O endereço do repositório
será informado junto à versão publicada; ainda não há endereço definido.

Abra PowerShell nessa pasta e execute:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\INSTALAR.ps1 -CheckOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\INSTALAR.ps1
```

O primeiro comando verifica requisitos. O segundo baixa os pacotes definidos
no package-lock.json usando npm ci --ignore-scripts e prepara as pastas locais.
Também reconstrói 19 efeitos sonoros técnicos com FFmpeg, usando os sintetizadores
do próprio motor. Não copia áudios de outra instalação e preserva arquivos
existentes. A reconstrução e a repetição sem alterações foram testadas em pasta vazia.
Reexecutar não deve apagar produções nem credenciais; o npm recompõe node_modules.
A configuração da máquina fica em %LOCALAPPDATA%\GeradorDeVideos\installation.json.

Para sincronismo de voz, instale também Python 3.11 com o launcher py e execute:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\INSTALAR.ps1 -WithWhisper
```

Essa opção instala openai-whisper 20250625 em um ambiente separado e baixa
explicitamente o modelo small para CPU. Requer internet e espaço adicional.
A instalação Python e uma transcrição real em CPU foram validadas na cópia
de revisão deste computador. Isso não equivale a um novo usuário Windows ou
a outra máquina. As dependências transitivas não estão fixadas pelo instalador;
a aceleração GPU ainda não foi validada na distribuição.

## Abrir e trabalhar

- INICIAR.cmd inicia o app local e abre o gerador. A porta é 5599.
- DIAGNOSTICAR.cmd apresenta o diagnóstico e o estado das sessões.
- ATIVAR-CONTAS.cmd conduz a configuração das contas Google e Flow Music.
- ATUALIZAR.ps1 usa git pull --ff-only e reinstala dependências. Recusa uma
  árvore Git com alterações locais; resolva essas alterações antes de atualizar.

Se a porta estiver ocupada por outra cópia, o iniciador informa o conflito.
Não encerre processos desconhecidos. Logs de abertura ficam em CORE/diagnosticos.

O motor local Three.js não depende de login Google. Geração externa, narração
e música dependem do acesso da sua própria conta. Consulte THREE-DESIGN-STUDIO.md
para exemplos do motor. Um MP4 neutro Three.js já foi renderizado e verificado
na cópia de revisão; essa prova não cobre todas as rotas do gerador.

As novas produções ficam em CORE/outputs. Referências de pessoas são opcionais
e locais; a distribuição não leva fotos. Selecionar um arquivo não dispensa a
autorização de uso exigida pelo fluxo de produção.

## Ativar as próprias contas

Em CORE, os comandos existentes também podem ser usados individualmente:

```powershell
npm run session -- setup --provider google
npm run session -- setup --provider flow-music
npm run session -- status
```

Faça o login manual na janela aberta pelo setup e siga a orientação do comando.
Use a sua conta e conclua a autenticação em duas etapas quando solicitada.
O projeto captura os cookies necessários para o cofre do usuário Windows;
não é necessário colar cookies no chat nem inseri-los manualmente no Git.
Este projeto não utiliza GEMINI_API_KEY.

O perfil renovável fica em %LOCALAPPDATA%\GeradorDeVideos\BrowserSessions.
O Credential Manager é o cache local das sessões. Nunca distribua esses dados.
Para tentar renovar uma sessão antes de uma produção:

```powershell
npm run session -- refresh --provider google
npm run session -- refresh --provider flow-music
```

Se a sessão tiver sido encerrada pelo provedor, repita setup. Cookies presentes
não garantem que todos os serviços estejam liberados para a conta. Testes reais
de Omni, Vids e música devem usar a conta do destinatário e uma produção explícita.

Drive é opcional e exige um helper próprio configurado em STUDIO_GCP_CLI.
Não copie caminhos, permissões nem credenciais de outro usuário para ativá-lo.

## Evidência atual de instalação

### Backend opcional de Whisper

O instalador prepara openai-whisper. O código também inclui o driver Python
faster-whisper-words.py para um backend alternativo; esse pacote de reconhecimento
não é instalado por padrão. Use um interpretador isolado com suas dependências
e informe-o explicitamente. Consulte `npm run video -- align --help` para
`--whisper-backend` e `--whisper-python`; a biblioteca também reconhece
FASTER_WHISPER_PYTHON. Não altere o ambiente do Whisper padrão para experimentar.

Escolher o backend alternativo não autoriza fallback silencioso nem garante
equivalência de palavras e tempos. Compare suas medições antes de adotá-lo em
uma produção. Use uma pasta de medição nova: o driver escreve o JSON de saída
informado. O teste de integração usa Python real com o reconhecedor simulado;
não valida modelo baixado, precisão da fala, CTranslate2 ou CUDA.

### Verificações realizadas

O instalador completo, sem -WithWhisper, foi executado na cópia de revisão com
LOCALAPPDATA separado para teste. npm ci, preparação dos efeitos sonoros,
criação de outputs/diagnosticos e gravação do Chrome em installation.json
terminaram com código 0. O primeiro grupo de 16 testes passou pelo comando
npm test, sem chamadas de geração. Outros grupos foram incluídos e verificados
separadamente durante a revisão; isso não equivale à suíte completa original.

O instalador também concluiu -WithWhisper com código 0, criando o ambiente
Python e carregando o modelo small em CPU. Depois, transcribeWordTimestamps
encontrou o executável pela configuração local da instalação e transcreveu
corretamente uma frase sintética em português, com 11 palavras e tempos válidos.
A fala foi criada localmente pelo Windows para teste; não foi usada voz pessoal
nem chamado provedor externo. Os caches e áudios desse teste ficam fora do Git.

Esses testes usaram executáveis já instalados no computador e não representam
um novo usuário Windows ou uma máquina sem requisitos. Não validam cofre de
credenciais, login Google/Flow, GPU ou toda a suíte original. A seleção de
testes e a revisão de distribuição continuam em andamento.

