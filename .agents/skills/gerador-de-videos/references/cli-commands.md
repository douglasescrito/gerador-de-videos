# Comandos e sessões

Execute em CORE. O contrato completo está em docs/AGENT-CONTRACT.md. Para descobrir
opções, use `npm run video -- commands --format json` e a ajuda do comando.

```powershell
npm run doctor
npm run session -- status
npm run session -- setup --provider google
npm run session -- setup --provider flow-music
npm run session -- refresh --provider google
npm run session -- refresh --provider flow-music
```

Setup abre um Chrome normal para login manual. Cada usuário usa a própria conta.
Não automatize senha ou 2FA. O perfil renovável e o cache do Credential Manager
são privados ao usuário Windows. Cookies válidos não garantem acesso a serviços.

```powershell
npm run video -- generate --mode raw --prompt "Uma esfera translúcida sob luz suave" --collection primeiro-clipe
npm run video -- dry-run --spec filme.json
npm run video -- plan --spec filme.json
npm run video -- run --state outputs/minha-colecao/metadados/film-state.json
npm run video -- status --state outputs/minha-colecao/metadados/film-state.json
npm run video -- resume --state outputs/minha-colecao/metadados/film-state.json
```

Os caminhos de estado acima são ilustrativos: use o `stateFile` real retornado
pelo planejamento. Não confundir spec de filme, receita mestre e preset de render.
`run`/`resume` recebem estado; não inventar `run --recipe` ou `resume --production-id`.

Use `npm run acervo` ou INICIAR.cmd para abrir o app. Drive exige configuração
própria, destino explícito, dry-run e confirmação de escrita. Não copiar helper
ou credenciais de outra pessoa nem tratar uma integração ausente como ativa.
