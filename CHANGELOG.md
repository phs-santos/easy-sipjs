# Changelog

## [2.7.0] - 2026-07-01

### Alterado
- Exemplo `examples/softphone` migrado de React para **Vue 3 + Vite + TypeScript**.
- UI do discador compactada para não cortar o botão inferior em telas com pouca altura.
- Conteúdo principal agora usa scroll interno controlado (`100dvh`) em vez de cortar cards.
- Monitor técnico permanece ao lado do telefone na tela inicial quando não há chamada ativa.

### Adicionado
- Export `easy-sipjs/vue` com composable `useSipClient()` para projetos Vue.
- Dependência `vue` marcada como peer dependency opcional.

### Removido
- Export `easy-sipjs/react` e exemplo React.


## [2.6.1] - 2026-07-01

### Corrigido
- Desligamento local da chamada no softphone: a UI remove a sessão imediatamente e o core emite término local mesmo se o proxy/peer demorar a finalizar.
- Layout da chamada ativa ajustado para não forçar scroll da página; cards técnicos usam scroll interno.

### Alterado
- Monitor técnico passa a aparecer ao lado do discador na tela inicial quando não há ligação ativa.
- Removidos textos explicativos da interface de demonstração que não agregavam ao teste do cliente.

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
- Softphone de exemplo redesenhado com UX/UI premium: glassmorphism, hierarquia visual, status cards, diagnóstico, health check, qualidade de chamada.
- `README.md` e `NPM.md` atualizados para explicar a API fácil e os novos recursos.

### Corrigido
- Provider JsSIP implementa `getQuality()` para manter contrato `ISipSession` completo.
- Logs SIP do exemplo deixam de exibir dados sensíveis quando a lib está com redaction ativo.

## [2.5.0] - 2026-07-01

### Adicionado
- API amigável `connect`, `disconnect`, `dial`, `accept`, `reject`, `reconnect`, `refreshRegistration`, `checkHealth`, `subscribePresence` e `unsubscribePresence`.
- Eventos ricos de sessão e health check via SIP OPTIONS.
- Suporte inicial a presença/BLF, DTMF `auto`, cleanup de tracks e build ESM NodeNext.
