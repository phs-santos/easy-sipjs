# Changelog

## [3.0.0] - 2026-10-04

### Alterado (pode exigir ajuste)
- `SipJSProvider`, `SipJSSession`, `JsSIPProvider` e `JsSIPSession` saíram do entry principal e passaram para `easy-sipjs/sipjs` e `easy-sipjs/jssip`. O entry principal continua exportando os tipos. Cada stack SIP agora é carregada sob demanda: com `provider: 'sipjs'` o bundle do app cai de ~553 KB para ~301 KB minificado.
- `connect()`/`register()` só resolvem depois do 200 OK do REGISTER e rejeitam quando o registro é recusado ou não tem resposta (o erro traz `statusCode` e `reasonPhrase`). Antes resolviam assim que o REGISTER era enviado.
- `hold()`, `unhold()`, `upgradeToVideo()` e `downgradeToAudio()` (SIP.js) esperam o outro lado aceitar o re-INVITE, rejeitam se ele recusar e lançam erro se já houver outro re-INVITE em andamento, em vez de retornar sem fazer nada.
- O refresh do REGISTER fica só com o SIP.js/JsSIP, no prazo concedido pelo servidor. O timer fixo de 3600 s, que mandava um REGISTER duplicado, agora só roda para `customProvider` sem `managesRegistrationRefresh`; `registration-expiring`/`onExpiring` seguem a mesma regra.
- O Contact do provider SIP.js usa `transport=ws` (padrão do SIP.js) em vez de `wss`, que fazia o 200 OK do REGISTER ser descartado em alguns PBXs. Configurável em `contactParams`.
- Presença/BLF em `dialog-info`: ramal sem diálogo ativo (`terminated`) é `available`, não `offline`; `early` é `ringing`.
- `setRemoteVolume()` usa o volume do elemento de 0 a 1 e só cria o ganho Web Audio acima de 1.
- O preset `generic` passa a usar DTMF `auto` e a espera padrão do SIP.js; `asterisk`, `kamailio` e a ausência de preset continuam com SIP INFO e `a=inactive`.
- SIP MESSAGE recebido (SIP.js) é respondido com 200 OK pela biblioteca. `message.accept()` continua existindo e não faz nada.
- O pacote do npm não leva mais os sourcemaps do bundle IIFE (de 3,6 MB para ~750 KB) nem o `NPM.md`, que era idêntico ao README.

### Adicionado
- `iceGatheringTimeoutMs` (padrão 1000 ms) nas credenciais e em `createSoftphone()`: limita a espera por candidatos ICE, que era de até 5 s no SIP.js e sem limite no JsSIP.
- `earlyMedia` em `CallOptions`: aplica o SDP do 183 e toca o áudio do PBX antes do atendimento.
- `sounds: false` (ou `false` por som) para o app cuidar dos próprios toques.
- Eventos `reconnecting`, `reconnect-failed` e `unregistered`.
- `CallStatsSampler` e o campo `note` em `PresenceEvent`.
- Presets com efeito real e opções `dtmfMode`, `holdStrategy` (`asterisk-inactive`, `asterisk-sendonly`, `sipjs-default`) e `mediaRecovery` no cliente.
- Recuperação de mídia mais rápida: reinício de ICE depois de 3 s em `disconnected` (antes só em `failed`, 15 a 30 s depois) e `session.recoverMedia()`, que o cliente chama nas chamadas em andamento quando o WebSocket volta.
- `uniqueContact` nas credenciais, para vários registros simultâneos no mesmo ramal.
- `SipError` com `code` estável e `SipLogCode` no `label` das linhas de log do cliente.
- Vue: `isMuted`, `isOnHold`, `setMuted()`, `setHeld()`, `hangup()` e `setActiveSession()` no composable.
- ESLint (`npm run lint`), `npm run typecheck` e workflows do GitHub Actions: CI em push/PR e publicação no npm por tag com trusted publishing.

### Corrigido
- O stream remoto é ligado ao elemento assim que o handler de mídia existe, não só em `Established`.
- `failed` sai antes de `terminated` em chamadas recusadas, e `terminated` leva o código SIP.
- Reconexão: primeira tentativa em até 500 ms, backoff com jitter, e o evento `online` zera o contador (antes o cliente desistia para sempre depois de `maxReconnectAttempts`).
- Health check: dois pings sem resposta derrubam o socket e reconectam; o timer não morre mais depois de `disconnect()`/`updateCredentials()`.
- Depois de reconectar, o estado só vira `registered` com o registro confirmado, e as inscrições de presença são refeitas. No JsSIP elas não são mais refeitas a cada refresh do registro.
- `unsubscribePresence('10')` não remove mais `100` ou `1010`.
- `setRemoteVolume()` não deixa mais o elemento de áudio mudo na chamada seguinte.
- Toques sintetizados: um `AudioContext` compartilhado em vez de um por toque, sem o timer solto que cortava o tom ao parar e tocar em seguida; toque e ringback não se cancelam mais.
- JsSIP: áudio remoto em chamadas recebidas (o wrapper era criado depois do `peerconnection`).
- Perda de pacotes de `getQuality()` é medida entre amostras, não acumulada desde o início; o codec reportado é o do áudio recebido.
- A recuperação de mídia avisa o SIP.js do reinício de ICE, que assim espera os candidatos novos antes de enviar a oferta.
- Vue: `sessions` é `shallowRef`, `activeSession` atualiza, e o convite some quando quem ligou desiste.

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
