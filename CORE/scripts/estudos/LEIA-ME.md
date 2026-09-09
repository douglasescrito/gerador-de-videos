# Ferramentas auxiliares e exemplos locais

Esta pasta da distribuição contém recursos técnicos revisados. Scripts que
registravam produções particulares, seus roteiros, caminhos e campanhas não
acompanham o pacote. O nome histórico da pasta não significa que seus arquivos
dependam de um acervo anterior.

| Recurso | Uso |
| --- | --- |
| [generate-synthetic-sfx.mjs](generate-synthetic-sfx.mjs) | Síntese técnica reutilizada pela preparação de efeitos locais |
| [run-studio-golden-corpus.mjs](run-studio-golden-corpus.mjs) | Compilação repetida de briefs de teste, sem gerar mídia |
| [run-html-motion-pilot.mjs](run-html-motion-pilot.mjs) | Render de um exemplo gráfico pelo renderer HTML existente |
| [render-3pistas-master.mjs](render-3pistas-master.mjs) | Mixagem de voz, música e SFX próprios com parâmetros explícitos |
| [finalize-live-multi-voice-proof.mjs](finalize-live-multi-voice-proof.mjs) | Finalização de evidências de narração multivoz; não acompanha gravações anteriores |

Execute os scripts a partir de CORE e confira os argumentos exigidos antes de
usar seus arquivos. Os testes locais não comprovam disponibilidade dos provedores
nem aprovam automaticamente uma capacidade. Para geração e execução de produções,
use o [contrato do CLI](../../docs/AGENT-CONTRACT.md).

O piloto HTML não requer login. Ele renderiza oito segundos de gráficos e publica
MP4, recibo e metadados; não cria narração ou trilha. Por padrão usa
CORE/outputs/html-motion-pilot-local. Para uma pasta nova explicitamente escolhida:

```powershell
node scripts/estudos/run-html-motion-pilot.mjs --collection=outputs/meu-piloto-local
```

O argumento desse script é um caminho de diretório, não o slug do comando batch.
Recursos, rede e relógio seguem as regras do renderer local. Confira o arquivo
físico e o recibo antes de considerar o teste concluído. Não copie diagnósticos
ou produções gerados por esses scripts para uma nova distribuição.

## Auxiliar histórico de transcrição

[run_whisper.py](run_whisper.py) conserva uma interface simples para experimentar
Whisper local: recebe áudio e um caminho de JSON novo, usa modelo base, português
e timestamps por palavra. Requer openai-whisper no Python escolhido; não faz
parte da instalação Node. O modelo pode precisar de download no primeiro uso.
O script recusa saída existente, inclusive criada durante a transcrição, e não
cria diretórios. Uma falha de escrita pode deixar JSON parcial: preserve-o para
diagnóstico e escolha outro destino na próxima tentativa.

Para produção, use align no CLI Studio, com roteiro próprio e validação dos
timestamps. Este auxiliar retorna o JSON bruto do Whisper; não valida sincronia
contra roteiro, não cria recibo Studio e não faz montagem. Não confunda sua
saída com uma entrega audiovisual validada.

## Converter SVG próprio em PNG

`node scripts/estudos/render-logo-png.mjs entrada.svg saida.png 1200 500`

Ferramenta local de preparação de imagem: usa Chrome headless, aceita CHROME_PATH,
renderiza o SVG como imagem inerte e bloqueia rede. Preserva transparência e recusa
sobrescrever o destino. Fontes externas não são carregadas; para aparência portátil,
use texto convertido em caminhos no SVG. Não gera vídeo nem recibo de produção.
