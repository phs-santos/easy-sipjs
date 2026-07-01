# Changelog

## [2.6.0] - 2026-07-01

### Adicionado
- `createSoftphone()` com presets `asterisk`, `kamailio` e `generic`.
- `DeviceManager` exposto em `client.devices` com listagem, permissão e evento de mudança de headset/câmera.
- `diagnose()` para validar HTTPS, MediaDevices, permissão de microfone, speaker selection, registro SIP e health check.
- `session.getQuality()` com score, nível, jitter, perda, RTT e recomendação operacional.
- ICE self-healing básico com `restartIce()` + re-INVITE quando `iceConnectionState` entra em `failed`.
- Redação segura de logs SIP via `redactSipLog()`.
- Health check periódico opcional via `healthCheckIntervalMs`.
- Resubscribe automático de presença/BLF após registro/reconexão.

### Alterado
- Softphone de exemplo redesenhado com UX/UI premium: glassmorphism, hierarquia visual, status cards, diagnóstico, health check, qualidade de chamada e paleta baseada em confiança/segurança.
- `README.md` e `NPM.md` atualizados para explicar a API fácil e os novos recursos.

### Corrigido
- Provider JsSIP implementa `getQuality()` para manter contrato `ISipSession` completo.
- Logs SIP do exemplo deixam de exibir dados sensíveis quando a lib está com redaction ativo.

## [2.5.0] - 2026-07-01

### Adicionado
- API amigável `connect`, `disconnect`, `dial`, `accept`, `reject`, `reconnect`, `refreshRegistration`, `checkHealth`, `subscribePresence` e `unsubscribePresence`.
- Eventos ricos de sessão e health check via SIP OPTIONS.
- Suporte inicial a presença/BLF, DTMF `auto`, cleanup de tracks e build ESM NodeNext.
