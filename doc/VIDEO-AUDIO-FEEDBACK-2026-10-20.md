# Revisão de áudio durante chamadas de vídeo — 2026-10-20

## Cenário e reprodução

No cockpit henrilgrim-phone, iniciar/atender uma chamada de vídeo usando alto-falantes próximos do microfone. Relato: ruído intenso ao iniciar vídeo. O fenômeno exato ainda não foi capturado em áudio ou stats.

## Causa provável (não confirmada)

Realimentação acústica e/ou ganho de reprodução elevado. O app permitia amplificação até 200%, e as capturas iniciais nos providers usavam `audio: true`, sem solicitar explicitamente processamento de voz. Outras causas (loop de áudio, codec, hardware, PBX) permanecem possíveis.

## Correção

- SIP.js e JsSIP: pedir echoCancellation, noiseSuppression e autoGainControl nas chamadas iniciais.
- SIP.js e JsSIP: preservar essas preferências ao substituir microfone; SIP.js também nas renegociações que consultam audioConstraint().
- App de teste: volume inicial 65%, limite 100%, botão para silenciar saída por chamada. A prévia local continua muted.

## Impactos e limites

Sem alterações nos contratos públicos. Constraints são hints sujeitos a suporte do navegador. AEC não resolve loopback no PBX nem problemas físicos severos. O volume baixo não prova eliminação da causa raiz. O app continua usando `file:../easy-sipjs`.

## Verificação manual

1. Comparar áudio e vídeo com headset e com alto-falantes, em SIP.js e JsSIP.
2. Verificar `track.getSettings()` para echoCancellation/noiseSuppression/autoGainControl, quando disponíveis.
3. Alternar hold/unhold, mute, troca de microfone, upgrade/downgrade e encerrar.
4. Confirmar que silenciar saída interrompe o som imediatamente e não silencia o microfone remoto na rede.
5. Verificar que duas abas não reproduzem a mesma chamada.

## Validação

A validação automatizada depende de dependências instaladas e navegador/WebRTC real; não equivale a teste acústico. Consulte o status informado junto ao pacote.
