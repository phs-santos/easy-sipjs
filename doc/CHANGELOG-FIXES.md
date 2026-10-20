# Correções de estabilização (base 3.1.1)

## FIX-001 — Timer ICE pendente no JsSIP

- **Classificação:** risco identificado por inspeção; teste de regressão adicionado.
- **Origem:** `src/core/jssip-provider.ts`, listener `icecandidate` de `JsSIPSession`.
- **Causa provável:** timer agendado poderia sobreviver ao término e chamar `ready()` fora do ciclo de vida.
- **Mudança:** rastreamento dos timers e cancelamento em `cleanupAudio()`, com guarda de `terminated`.
- **Como reproduzir antes:** criar sessão JsSIP, emitir `icecandidate`, encerrar antes do timeout, avançar relógio; observar possível `ready()` tardio.
- **Como validar depois:** teste `JsSIPSession resource cleanup > cancels pending ICE ready callbacks when the session ends`; `ready()` não deve executar.
- **Impacto:** apenas provider JsSIP; sem alteração na API pública.

## FIX-002 — Listeners de RTCPeerConnection após término

- **Classificação:** risco de listeners órfãos por inspeção.
- **Origem:** `src/core/jssip-provider.ts` e `src/core/sipjs-provider.ts`.
- **Causa provável:** listeners de eventos de mídia/conexão não removidos em todos os caminhos de cleanup.
- **Mudança:** callbacks de remoção vinculados ao ciclo de vida das sessões.
- **Como reproduzir antes:** simular `peerconnection`, registrar handlers, encerrar sessão e inspecionar `removeEventListener`.
- **Como validar depois:** teste JsSIP `removes peer connection listeners when the session ends`; para SIP.js, conferir remoção nos cenários de término/erro com teste adicional (pendente).
- **Impacto:** ambos providers; testar que mídia remota continua funcionando enquanto a sessão está ativa.

## FIX-003 — Screen sharing no encerramento (JsSIP)

- **Classificação:** risco de recurso de mídia ativo após encerramento.
- **Origem:** `src/core/jssip-provider.ts`, `screenTrack` e `cleanupAudio()`.
- **Causa provável:** track de tela e `onended` podem permanecer vivos após a sessão terminar.
- **Mudança:** limpar `onended`, parar a track e descartar referências.
- **Como reproduzir antes:** compartilhar tela e encerrar chamada sem executar stopShare manual.
- **Como validar depois:** em navegador, a captura de tela deve parar após encerramento; instrumentar `track.stop()` em teste unitário adicional (pendente).
- **Impacto:** JsSIP; testar também stopShare durante chamada e término normal.

## FIX-004 — Callback tardio de recuperação ICE (SIP.js)

- **Classificação:** risco de operação tardia após encerramento.
- **Origem:** `src/core/sipjs-provider.ts`, recuperação ICE e cleanup de mídia.
- **Causa provável:** tarefas assíncronas podem continuar após a sessão ser finalizada.
- **Mudança:** guardas de ciclo de vida e cleanup de listeners/timers de recuperação.
- **Como reproduzir antes:** simular falha ICE e terminar a sessão antes do callback de recuperação.
- **Como validar depois:** confirmar que não há renegociação após término; teste de regressão específico ainda pendente.
- **Impacto:** SIP.js; revisar re-INVITE, hold e reconexão em PBX real.

## FIX-005 — `unregister()` enfileirado e reconexão

- **Classificação:** risco de concorrência identificado por inspeção.
- **Origem:** `src/index.ts`, `unregister()` e `doUnregister()`.
- **Causa provável:** a intenção de desconexão era sinalizada somente ao executar a tarefa na fila.
- **Mudança:** `intentionalDisconnect = true`, `started = false` e cancelamento de timers antes de enfileirar `doUnregister()`.
- **Como reproduzir antes:** ocupar a fila com operação pendente, agendar reconnect, chamar `unregister()` e verificar se o reconnect continua antes de processar a fila.
- **Como validar depois:** nenhum novo retry deve iniciar após solicitar `unregister()`; testar também registro subsequente e múltiplas chamadas simultâneas.
- **Impacto:** `SipClient`, independentemente do provider; API pública preservada.

## Pendências

Não declarar o patch completamente validado até que os testes, o build e os cenários de PBX/navegador sejam executados. Testes automatizados adicionais recomendados para FIX-002 no SIP.js e FIX-003 a FIX-005.
