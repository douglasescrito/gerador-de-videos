# Entrega diária no Google Drive

`drive-deliver` é a etapa canônica de publicação externa de uma coleção já
gerada e validada. Ela não chama Gemini e não altera os masters locais.

## Estrutura remota

```text
<pasta-raiz>/
  AAAA-MM-DD/
    <nome-da-peça>/
      videos/
      receitas/
```

- `videos/`: masters encontrados em `videos-unidos/`.
- `receitas/`: JSON de `receitas/`, sidecars `*.receipt.json` da coleção e o
  recibo final da própria publicação.

## Uso

Configure seu próprio helper cli-gcp e suas permissões no Drive. Informe seu
cliente no helper; o nome abaixo é um exemplo, não uma conta pré-configurada.
Use STUDIO_GCP_CLI ou --gcp-cli para apontar ao seu helper. Esta dependência é
opcional e não acompanha cookies ou acessos do autor.


Planejar sem escrever:

```powershell
npm run video -- drive-deliver `
  --collection nome-da-colecao `
  --root-folder-id <id-ou-url> `
  --client meu-cliente `
  --dry-run true
```

Publicar depois de revisar o plano:

```powershell
npm run video -- drive-deliver `
  --collection nome-da-colecao `
  --root-folder-id <id-ou-url> `
  --client meu-cliente `
  --dry-run false `
  --confirm-drive-write true
```

Opções:

- `--name`: nome remoto da peça; o padrão é o nome da coleção.
- `--date`: pasta diária em `AAAA-MM-DD`; o padrão é a data local.
- `--receipt`: caminho alternativo para o recibo local.
- `--gcp-cli`: caminho alternativo para `gcp.ps1`.

## Garantias

- dry-run sem escrita por padrão, com leitura do Drive para validar a pasta-raiz,
  detectar duplicidades e reconciliar conteúdo já presente;
- escrita externa somente com confirmação literal;
- criação/reuso determinístico de uma pasta exata por nível;
- falha fechada se houver pastas ou arquivos duplicados;
- nenhum overwrite de conteúdo divergente;
- idempotência por nome, tamanho e MD5;
- upload resumível com retomada de oscilações de transporte;
- releitura e verificação de todos os arquivos;
- recibo canônico `mkt-videos/receipt@1`, encadeado como
  `drive-daily-delivery`, salvo localmente e publicado em `receitas/`;
- OAuth e refresh token permanecem no Windows Credential Manager do
  `cli-gcp`.

O ID da pasta-raiz e o segmento OAuth ficam registrados no recibo, mas tokens,
cookies, client secrets e cabeçalhos de autorização nunca entram em manifestos,
logs ou artefatos.
