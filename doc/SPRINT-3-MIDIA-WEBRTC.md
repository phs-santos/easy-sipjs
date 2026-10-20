# Sprint 3 — Hold/unhold JsSIP: erros de renegociação

## Escopo e status
Correção pontual implementada. Demais cenários (áudio remoto, troca de microfone, ICE e SDP em rede real) **não foram corrigidos nem validados** nesta entrega.

## Caso 1 — hold não aceito
- **Causa:** `JsSIPSession.hold()` ignorava o retorno booleano de `RTCSession.hold()` e resolvia a Promise mesmo se a solicitação fosse rejeitada.
- **Reprodução automatizada anterior:** criar sessão mock com `isOnHold() => {local:false,remote:false}`, `isReadyToReOffer() => true`, `hold() => false`; chamar `await session.hold()`; antes, resolvia indevidamente.
- **Depois:** a chamada rejeita com erro descritivo.
- **Teste:** `test/jssip-provider.test.ts`, `rejects a failed hold request rather than silently resolving`.

## Caso 2 — unhold não aceito
- **Causa:** `JsSIPSession.unhold()` ignorava o retorno booleano de `RTCSession.unhold()`.
- **Reprodução anterior:** `isOnHold() => {local:true,remote:false}`, `isReadyToReOffer() => true`, `unhold() => false`; antes, resolvia indevidamente.
- **Depois:** a chamada rejeita.
- **Teste:** `rejects a failed unhold request`.

## Caso 3 — renegociação indisponível
- **Causa:** o wrapper não verificava `isReadyToReOffer()` antes de solicitar hold.
- **Reprodução anterior:** mock com `isReadyToReOffer() => false`; antes, chamava `hold()` sem informar erro.
- **Depois:** rejeita antes de solicitar renegociação.
- **Teste:** `rejects hold when the provider cannot renegotiate`.

## Teste manual com PBX
1. Conectar JsSIP e completar chamada com áudio bidirecional.
2. Executar hold, confirmar evento e SDP no PBX.
3. Executar unhold e confirmar áudio bidirecional.
4. Repetir durante renegociação em andamento e verificar erro observável, sem sinalizar sucesso falso.
5. Repetir no SIP.js para avaliar paridade, sem pressupor implementação idêntica.

## Compatibilidade
Não altera assinaturas públicas; muda o comportamento de falhas antes silenciosas para Promise rejeitada. Consumidores devem tratar rejeições de `hold()` e `unhold()`.

## Limites
A Promise representa aceitação local do pedido de renegociação pelo JsSIP, **não** confirmação final do re-INVITE pelo PBX. Os eventos `hold`/`unhold` devem ser usados para observar a mudança de estado.
