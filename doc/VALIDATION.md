# Evidências de validação — Sprint 1 (patch de estabilização, base 3.1.1)

**Execução:** 2026-10-20 · macOS 26.7.1 · Node 26.5.0 · Vitest 4.1.12 · commit da correção `12c6562`.

## Comandos

| Comando                         | Resultado                                                |
| ------------------------------- | -------------------------------------------------------- |
| `npm run lint`                  | PASSOU                                                   |
| `npm run typecheck`             | PASSOU                                                   |
| `npm test`                      | PASSOU — 93/93 (5 execuções seguidas, sem instabilidade) |
| `npm run build`                 | PASSOU                                                   |
| Integração PBX / navegador real | NÃO EXECUTADA                                            |

## Antes/depois

Os mesmos testes foram executados contra o código anterior à correção (`aa8d6d2`) e contra a correção.

| ID             | Teste                                                          | Antes (`aa8d6d2`) | Depois | Conclusão                                                                                                       |
| -------------- | -------------------------------------------------------------- | ----------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| FIX-001        | `jssip-provider.test.ts` › cancels pending ICE ready callbacks | FALHA             | PASSA  | Defeito reproduzido e corrigido                                                                                 |
| FIX-002 JsSIP  | `jssip-provider.test.ts` › removes peer connection listeners   | FALHA             | PASSA  | Defeito reproduzido e corrigido                                                                                 |
| FIX-002 SIP.js | `sprint1-regression.test.ts` › FIX-002 (2 testes)              | FALHA             | PASSA  | Defeito reproduzido e corrigido                                                                                 |
| FIX-003        | `sprint1-regression.test.ts` › FIX-003 (2 testes)              | FALHA             | PASSA  | Defeito reproduzido e corrigido                                                                                 |
| FIX-004        | `sprint1-regression.test.ts` › FIX-004 (2 testes)              | PASSA             | PASSA  | **Não reproduzido**: o código anterior já ignorava a recuperação depois do encerramento. A mudança é defensiva. |
| FIX-005        | `sprint1-regression.test.ts` › FIX-005                         | PASSA             | PASSA  | **Não reproduzido**: a reconexão enfileirada atrás do `unregister()` já era descartada. A mudança é defensiva.  |

## Pendências

- Cenários manuais de `TESTING.md` (PBX de homologação, 20 chamadas seguidas, queda de rede, indicador de captura de tela no navegador).
