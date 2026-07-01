# easy-sipjs

Uma camada de abstração de alto nível sobre **SIP.js** e **JsSIP** para criar softphones WebRTC sem expor o usuário da biblioteca ao boilerplate do SIP.js.

A ideia é simples: quem usa a lib configura **ramal, domínio, senha e WebSocket**. A biblioteca cuida de `UserAgent`, `Registerer`, `Inviter`, reconexão, refresh de registro, eventos de sessão, DTMF, mídia, transferência, presença/BLF e health check.

---

## Instalação

```bash
npm install easy-sipjs
```

---

## Recursos principais

- 🔌 **API simples para o consumidor**: `connect()`, `dial()`, `accept()`, `reject()`, `hangup()` e `disconnect()`.
- 🧠 **SIP.js encapsulado**: o usuário não precisa configurar `UserAgent`, `Registerer`, `Inviter` ou `SessionState`.
- 🔁 **Registro resiliente**: `refreshRegistration()` e renovação automática de REGISTER por padrão.
- 🌐 **Reconexão inteligente**: usa `UserAgent.reconnect()` quando disponível e fallback controlado quando não estiver.
- 🩺 **Health check**: `checkHealth()` valida WebSocket, registro, sessões ativas e SIP OPTIONS ping no provider SIP.js.
- 📞 **Eventos ricos de sessão**: `progress`, `established`, `terminated`, `failed`, `dtmf`, `refer`, `hold`, `unhold`.
- 🎧 **Mídia WebRTC pronta**: binding de elemento remoto/local, troca de microfone, saída de áudio e cleanup de tracks.
- 🔢 **DTMF flexível**: `sip-info`, `rtp-event` ou `auto`.
- 🔀 **Transferência**: transferência cega e atendida via REFER.
- 👀 **Presença/BLF**: `subscribePresence()` com eventos normalizados.
- 🔔 **Sons automáticos**: ringtone e ringback opcionais, com fallback por Web Audio API.
- 🧱 **Provider agnóstico**: SIP.js por padrão, JsSIP opcional.
- 📦 **ESM compatível**: build em NodeNext com imports `.js` válidos.

---

## Uso mais simples

```ts
import { SipClient } from 'easy-sipjs';

const client = new SipClient({
  domain: 'sip.meudominio.com',
  phone: '4001',
  secret: 'senha-do-ramal',
  server: 'wss://rtc.meudominio.com:8089/ws',
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
});

client.on('connection-state', state => {
  console.log('estado:', state);
});

client.on('invite', async invitation => {
  await client.accept(invitation, {
    remoteElement: document.querySelector('#remoteAudio') as HTMLAudioElement,
  });
});

await client.connect();

const session = await client.dial('4002', {
  remoteElement: document.querySelector('#remoteAudio') as HTMLAudioElement,
});

await session.sendDTMF('1');
await client.hangup();
```

---

## Configuração

```ts
const client = new SipClient({
  domain: 'sip.meudominio.com',
  phone: '4001',
  secret: 'senha-do-ramal',
  server: 'wss://rtc.meudominio.com/ws',
  authorizationUsername: '4001',
  nameexten: 'Agente 4001',
  userAgentString: 'MinhaCentral/1.0.0',
  debug: false,
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
}, {
  provider: 'sipjs',
  autoReconnect: true,
  autoRefreshRegistration: true,
  sounds: {
    ringtone: '/sounds/incoming.mp3',
    ringback: '/sounds/ringback.mp3',
  },
});
```

---

## Eventos principais

```ts
client.on('registered', () => console.log('registrado'));
client.on('register-failed', err => console.error('falha no registro', err));
client.on('disconnect', err => console.warn('desconectou', err));
client.on('health', status => console.log(status));

client.on('session-established', session => {
  console.log('chamada atendida', session.id);
});

client.on('session-failed', (session, event) => {
  console.log('chamada falhou', session.id, event.statusCode, event.reasonPhrase);
});

client.on('session-terminated', session => {
  console.log('chamada encerrada', session.id);
});
```

Cada sessão também tem eventos próprios:

```ts
session.on?.('progress', event => {
  if (event?.hasEarlyMedia) {
    console.log('early media detectada');
  }
});

session.on?.('dtmf', event => console.log('DTMF:', event.tone));
session.on?.('refer', event => console.log('REFER recebido:', event));
```

---

## Controle de chamada

```ts
session.mute();
session.unmute();

await session.hold();
await session.unhold();

await session.sendDTMF('1', { mode: 'sip-info', durationMs: 160 });
await session.sendDTMF('2', { mode: 'rtp-event' });
await session.sendDTMF('#', { mode: 'auto' });

await session.transfer('4003');          // transferência cega
await session.transfer(outraSession);    // transferência atendida

await session.setAudioInput('device-id');
await session.setAudioOutput('speaker-id');
session.setRemoteVolume(1.4);

await session.shareScreen();
await session.stopScreenSharing();

const stats = await session.getStats();
console.log(stats);
```

---

## Health check

```ts
const health = await client.checkHealth();

console.log({
  websocket: health.websocketConnected,
  registered: health.registered,
  activeSessions: health.activeSessions,
  ping: health.lastPingLatencyMs,
});
```

No provider SIP.js, o health check tenta um **SIP OPTIONS ping** para validar se o servidor SIP responde no nível de aplicação, não apenas se o browser está online.

---

## Presença / BLF

```ts
client.onPresence(event => {
  console.log(event.extension, event.status);
});

await client.subscribePresence('4002');

// BLF/dialog-info, quando suportado pelo PBX/proxy:
await client.subscribePresence('4003', { event: 'dialog' });
```

Status normalizados:

```ts
'available' | 'busy' | 'ringing' | 'offline' | 'unknown'
```

---

## Compatibilidade com API antiga

Os métodos antigos continuam funcionando:

```ts
await client.register();
await client.call({ destination: '4002' });
await client.answer(invitation, {});
await client.unregister();
```

Callbacks antigos também continuam disponíveis:

```ts
client.onRegister.onAccept = () => {};
client.onUserAgent.onInvite = invitation => {};
session.onTerminate = () => {};
```

Para código novo, prefira os eventos `client.on(...)` e `session.on(...)`.

---

## Licença

MIT
