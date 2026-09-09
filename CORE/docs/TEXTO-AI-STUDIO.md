# Texto pelo AI Studio

O comando `text` do CLI existente escreve direção de comerciais de produto.
Usa exclusivamente a sessão Google do estúdio; nenhuma chave de API local.

```powershell
npm run video -- text --prompt "Caneca de cerâmica artesanal" --atmosphere "Estúdio claro" --out outputs/direcao.json
```

Para um briefing em arquivo, substituir `--prompt` por `--prompt-file briefing.txt`.
`--dry-run true` apenas valida e mostra o pedido, sem escrever ou chamar o provedor.
O JSON final contém texto, entrada, hash do texto, datas e proveniência do modelo.
O destino é reservado antes de abrir a sessão: um arquivo já existente bloqueia
a chamada, inclusive se houver uma tentativa pendente ou não resolvida.
Falhas não são repetidas automaticamente. Não trocar de destino para contornar
uma tentativa não resolvida.

## Escopo verificado

O adapter integra a rota `/api/generate-prompt` do Omni Product Studio. A
identificação do modelo vem do contrato remoto inspecionado pelo adapter;
não é um campo garantido de toda resposta. Verifique a capacidade e a sessão
da sua conta antes de usar. Recibos de chamadas anteriores não acompanham a
distribuição e não comprovam disponibilidade na máquina do destinatário.

Essa rota tem instruções de sistema fixas: comercial de produto, direção em
inglês, sem voz, música ou textos sobrepostos. Não oferece chat geral nem edição
livre de receitas. Nenhum vídeo, imagem ou áudio é gerado pelo comando `text`;
o resultado é uma proposta textual e não altera receitas ou aprova conhecimento.
O assistente lateral do AI Studio é outra superfície e não foi integrado.

A rota aceita somente descrições textuais nesta integração. Referências de
imagem não são enviadas. A saída pode mencionar imagens mesmo sem recebê-las,
por causa das instruções fixas remotas; revisar antes de usar numa produção.

Validação local: `node --test test/product-prompt.test.mjs test/cli-bootstrap.test.mjs`.
