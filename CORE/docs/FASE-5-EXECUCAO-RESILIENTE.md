# Fase 5 — Execução resiliente

> Registro de arquitetura de uma etapa anterior. Não descreve, por si só, o estado atual desta distribuição. Use [Instalação Windows](INSTALACAO-WINDOWS.md), [guia do app](GERADOR-APP.md) e [contrato atual](AGENT-CONTRACT.md). Resultados e acervos privados daquela etapa não acompanham o pacote.

- `retry-reconcile-policy.mjs` é o classificador único. Estado ambíguo e falha exclusiva de persistência nunca criam nova submissão.
- `resource-broker.mjs` aplica capacidades globais em SQLite/WAL entre processos, com PID+nonce, heartbeat, recuperação de órfão, prioridade e fairness por cliente.
- `runtime-admission.mjs` revalida capability, prova, expiração, rights/revogação, disco, circuito e ambiguidade antes da aquisição.
- `schedule-controller.mjs` usa `scheduleId + plannedFireAt`, mantém um voo por schedule e colapsa atrasos para um único catch-up.
- `runtime-operations@1` expõe leases, filas e ciclos em modo read-only. Nenhum prompt, cookie ou token é capturado.
- CLI direta, lote e executor canônico compartilham o mesmo broker; draft/animate declaram o peso real da concorrência interna.

Testes provider-free cobrem retry/reconcile, `dueAt`, fairness, órfãos, admission, schedule e integração do batch. Uma prova com provedor real precisa ser uma produção explicitamente solicitada,
com contas e assets do operador. Testes locais não demonstram disponibilidade
remota nem desempenho de ponta a ponta.
