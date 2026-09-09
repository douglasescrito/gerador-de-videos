# Rollout do executor journal

Este guia trata da migração de estados legados. A seleção de compatibilidade resolve legacy por padrão, mas novas execuções canônicas exigem promoção explícita para journal. O rollout não reescreve recibos nem artefatos históricos.

1. `legacy`: usa somente `film-state.json`, comportamento atual.
2. `shadow`: compila `execution-plan@1`, migra o estado para o journal e compara equivalência; a execução continua no legado.
3. `journal`: só é selecionável quando a comparação não apresenta divergências. Esta flag prepara a troca gradual; chamadas reais continuam condicionadas aos mesmos gates de autorização.

```powershell
npm run video -- executor --action migrate --mode shadow --state outputs/<filme>/metadados/film-state.json
npm run video -- executor --action status --state outputs/<filme>/metadados/film-state.json
npm run video -- executor --action rollback --state outputs/<filme>/metadados/film-state.json
```

Rollback seleciona novamente `legacy` e trata o journal como uma projeção separada. Nenhum receipt é regravado, removido ou convertido. Divergência entre uma etapa concluída no legado e seu nó migrado bloqueia o modo `journal`.
