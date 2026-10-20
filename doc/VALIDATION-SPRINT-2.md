# Validação — Sprint 2 (registro e reconexão)

**Execução:** 2026-10-20 · macOS 26.7.1 · Node 26.5.0 · Vitest 4.1.12 · base anterior `12c6562`.

## Comandos

| Comando                               | Resultado                             |
| ------------------------------------- | ------------------------------------- |
| `npm run lint`                        | PASSOU                                |
| `npm run typecheck`                   | PASSOU                                |
| `npm test`                            | PASSOU — 93/93 (5 execuções seguidas) |
| `npm run build`                       | PASSOU                                |
| PBX Asterisk/Kamailio, navegador real | NÃO EXECUTADOS                        |

## Antes/depois

| Caso                                        | Teste                                                              | Antes (`12c6562`) | Depois | Conclusão                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------ | ----------------- | ------ | -------------------------------------------------------------------------------------- |
| 1 — callbacks após disconnect               | `client.test.ts` › ignores late transport and REGISTER callbacks   | FALHA             | PASSA  | Corrigido                                                                              |
| 2 — callbacks do registro antigo            | `client.test.ts` › ignores callbacks from a replaced registration  | FALHA             | PASSA  | Corrigido                                                                              |
| 3 — ping atrasado após disconnect           | `sprint2-regression.test.ts` › ping que falha depois do disconnect | PASSA             | PASSA  | Não reproduzido (já protegido)                                                         |
| 3 — ping atrasado após novo connect         | `sprint2-regression.test.ts` › ping da conexão anterior            | FALHA             | PASSA  | **A correção original não cobria**; completada nesta validação                         |
| 4 — reconnect lento + disconnect            | `sprint2-regression.test.ts` › caso 4                              | FALHA             | PASSA  | Corrigido                                                                              |
| INVITE pelo registro antigo                 | `sprint2-regression.test.ts` › convites atrasados                  | FALHA             | PASSA  | Corrigido                                                                              |
| `updateCredentials()` após disconnect       | `sprint2-regression.test.ts` › efeitos colaterais                  | PASSA             | PASSA  | **A correção original quebrava** (não registrava, sem erro); corrigido nesta validação |
| `connect()` / `reconnect()` após disconnect | `sprint2-regression.test.ts` › efeitos colaterais                  | PASSA             | PASSA  | Sem regressão                                                                          |

## Ajustes feitos durante a validação (`src/index.ts`)

1. `checkHealth()`: o resultado do ping só conta se a geração do registro não mudou durante o `await`. Antes, uma falha atrasada da conexão anterior somava com a primeira falha da conexão nova e derrubava o socket.
2. `updateCredentials()`: limpa `intentionalDisconnect` antes de registrar, como `register()`. Com a correção original, chamar depois de `disconnect()` retornava sem registrar.

## Pendências

Testes manuais com PBX real (casos 3 e 4 com rede instável) e os itens não cobertos listados em `SPRINT-2-REGISTRO-RECONEXAO.md`.
