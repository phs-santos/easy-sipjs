# Validação — Sprints 3, 4 e 5

**Execução:** 2026-10-20 · macOS · Node 26.5.0 · Vitest 4.1.12 · base anterior `7415a84`.

## Estado recebido

As entregas das sprints 3–5 não tinham rodado nenhum comando. Ao rodar:

- `npm run typecheck`: **FALHAVA** — a Sprint 5 usa `SipError('session-terminated', …)`, código que não existia em `SipErrorCode`. Corrigido adicionando o código (mudança aditiva).
- Continuação da Sprint 3 (troca de microfone): **sem nenhum teste**. Testes escritos nesta validação (`test/sprint3-audio-input.test.ts`).

## Antes/depois

| Sprint    | Caso                                                               | Antes (`7415a84`) | Depois | Conclusão         |
| --------- | ------------------------------------------------------------------ | ----------------- | ------ | ----------------- |
| 3         | JsSIP hold sem renegociação disponível                             | FALHA             | PASSA  | Corrigido         |
| 3         | JsSIP hold recusado pelo JsSIP                                     | FALHA             | PASSA  | Corrigido         |
| 3         | JsSIP unhold recusado                                              | FALHA             | PASSA  | Corrigido         |
| 3 (cont.) | Microfone: chamada termina com permissão pendente (SIP.js e JsSIP) | FALHA             | PASSA  | Corrigido         |
| 3 (cont.) | Microfone: duas trocas simultâneas (SIP.js e JsSIP)                | FALHA             | PASSA  | Corrigido         |
| 3 (cont.) | Microfone: dispositivo sem áudio — JsSIP                           | FALHA             | PASSA  | Corrigido         |
| 3 (cont.) | Microfone: dispositivo sem áudio — SIP.js                          | PASSA             | PASSA  | Já funcionava     |
| 4         | Downgrade recusado restaura o vídeo                                | FALHA             | PASSA  | Corrigido         |
| 4         | Downgrade aceito para a track antiga                               | PASSA             | PASSA  | Teste de controle |
| 5         | Duas recuperações de ICE simultâneas                               | FALHA             | PASSA  | Corrigido         |
| 5         | Chamada termina durante a recuperação                              | FALHA (pendurava) | PASSA  | Corrigido         |
| 5         | ICE restart recusado                                               | PASSA             | PASSA  | Já funcionava     |

## Problemas que as sprints não cobriam (encontrados no cockpit e corrigidos)

| Problema                                                              | Teste                               | Antes | Depois               |
| --------------------------------------------------------------------- | ----------------------------------- | ----- | -------------------- |
| `setAudioInput('')` ("padrão do sistema") dava `OverconstrainedError` | `media-controls.test.ts`            | FALHA | PASSA                |
| Trocar microfone desmutava a chamada                                  | `media-controls.test.ts`            | FALHA | PASSA                |
| `upgradeToVideo()` voltava para o microfone padrão (SIP.js)           | `media-controls.test.ts`            | FALHA | PASSA                |
| `shareScreen()` exigia vídeo já ativo                                 | `media-controls.test.ts` (4 testes) | FALHA | PASSA                |
| `onSipLog` não recebia nada sem `debug` (SIP.js) e nunca no JsSIP     | — (exige UA real)                   | —     | Verificar no cockpit |

## Comandos

| Comando              | Resultado                                                                        |
| -------------------- | -------------------------------------------------------------------------------- |
| `npm run lint`       | PASSOU                                                                           |
| `npm run typecheck`  | PASSOU                                                                           |
| `npm test`           | PASSOU — 116/116                                                                 |
| `npm run build`      | PASSOU                                                                           |
| PBX real / navegador | Parcial: cockpit usado em chamadas reais; vídeo e tela ainda precisam de reteste |

## Limites que continuam

- JsSIP `hold()` resolve quando o JsSIP aceita o pedido, não quando o PBX responde (no SIP.js espera a resposta). Diferença de comportamento entre providers.
- JsSIP `recoverMedia()` pode ficar pendente se o JsSIP não chamar o callback nem encerrar a sessão (sem timeout).
- Vídeo remoto preto e queda de ICE depois do `upgradeToVideo()` no PBX de teste: não reproduzido em teste unitário; depende do SDP trocado com o Asterisk (ver log SIP com `debug`).
