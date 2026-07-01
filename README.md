# easy-sipjs

SDK de softphone WebRTC/SIP de alto nível sobre **SIP.js** e **JsSIP**. A proposta é simples: quem consome a biblioteca informa ramal, domínio, senha e WebSocket; a lib cuida de registro, reconexão, refresh, mídia, DTMF, health check, qualidade de chamada, devices, presença/BLF e logs seguros.

---

## Instalação

```bash
npm install easy-sipjs
```

---

## O jeito mais fácil

```ts
import { createSoftphone } from 'easy-sipjs';

const phone = createSoftphone({
  preset: 'asterisk',
  domain: 'pbx.example.com',
  extension: '1001',
  password: 'senha-do-ramal',
  websocketUrl: 'wss://pbx.example.com:8089/ws',
});

phone.on('invite', invitation => phone.accept(invitation));
phone.on('health', status => console.log(status));

await phone.connect();
await phone.dial('4002');
```

O consumidor não precisa configurar `UserAgent`, `Registerer`, `Inviter`, `SessionState`, re-REGISTER ou detalhes internos do SIP.js.

---

## Recursos principais

- **API simples**: `connect()`, `dial()`, `accept()`, `reject()`, `hangup()`, `disconnect()`.
- **Presets**: `asterisk`, `kamailio` e `generic` via `createSoftphone()`.
- **Registro resiliente**: refresh automático de REGISTER e reconexão controlada.
- **Health check SIP**: `checkHealth()` com WebSocket, registro e SIP OPTIONS no provider SIP.js.
- **Diagnóstico de ambiente**: `diagnose()` valida HTTPS, permissões, mídia, speaker selection e registro.
- **DeviceManager**: `client.devices.list()`, `requestPermissions()`, `onChanged()`.
- **Qualidade de chamada**: `session.getQuality()` retorna score, jitter, perda, RTT e recomendação.
- **ICE self-healing**: tentativa de `restartIce()` + re-INVITE quando a mídia falha.
- **DTMF flexível**: `sip-info`, `rtp-event` ou `auto`.
- **Transferência**: blind e attended transfer via REFER.
- **Presença/BLF**: `subscribePresence()` com status normalizados.
- **Logs seguros**: redaction de Authorization, nonce, response, secrets e usuários SIP.
- **ESM correto**: NodeNext com imports `.js` válidos.
- **Exemplo softphone premium em Vue 3**: UI de demonstração com UX de call center.



## Vue 3

A biblioteca expõe um composable opcional para projetos Vue:

```ts
import { useSipClient } from 'easy-sipjs/vue';

const softphone = useSipClient({
  domain: 'pbx.example.com',
  phone: '1001',
  secret: 'senha-do-ramal',
  server: 'wss://pbx.example.com:8089/ws',
}, {
  preset: 'asterisk',
  provider: 'sipjs',
});

await softphone.dial('4002');
```

O exemplo `examples/softphone` agora é Vue 3 + Vite + TypeScript, sem React.

---

## Uso avançado com `SipClient`

```ts
import { SipClient } from 'easy-sipjs';

const client = new SipClient({
  domain: 'sip.meudominio.com',
  phone: '4001',
  secret: 'senha-do-ramal',
  server: 'wss://rtc.meudominio.com:8089/ws',
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}, {
  preset: 'asterisk',
  provider: 'sipjs',
  autoReconnect: true,
  autoRefreshRegistration: true,
  logRedaction: true,
  healthCheckIntervalMs: 30000,
});

client.on('connection-state', state => console.log('estado:', state));
client.on('invite', invitation => client.accept(invitation));

await client.connect();
```

---

## Devices

```ts
await client.devices.requestPermissions({ audio: true });

const devices = await client.devices.list();
const microphones = await client.devices.microphones();
const speakers = await client.devices.speakers();

client.devices.onChanged(devices => {
  console.log('headset/câmera mudou', devices);
});

client.devices.watch();
```

---

## Qualidade e estatísticas

```ts
const stats = await session.getStats();
const quality = await session.getQuality();

console.log(quality.score, quality.level, quality.recommendation);
```

Exemplo de retorno:

```ts
{
  score: 92,
  level: 'excellent',
  jitterMs: 8,
  packetLossPercent: 0.2,
  rttMs: 74,
  recommendation: 'Áudio estável. Condição ideal para atendimento.'
}
```

---

## Health check e diagnóstico

```ts
const health = await client.checkHealth();
const diagnostics = await client.diagnose();

console.log(health.registered, health.lastPingLatencyMs);
console.log(diagnostics.warnings);
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

await session.transfer('4003');
await session.transfer(outraSession);

await session.setAudioInput('device-id');
await session.setAudioOutput('speaker-id');
session.setRemoteVolume(1.4);

await session.shareScreen();
await session.stopScreenSharing();
```

---

## Presença / BLF

```ts
client.onPresence(event => {
  console.log(event.extension, event.status);
});

await client.subscribePresence('4002');
await client.subscribePresence('4003', { event: 'dialog' });
```

Status normalizados:

```ts
'available' | 'busy' | 'ringing' | 'offline' | 'unknown'
```

---

## Exemplo visual

O projeto `examples/softphone` foi redesenhado para demonstração com clientes:

- layout focado em teste rápido de chamada;
- status de conexão e chamada sempre visíveis;
- controles críticos bem separados dos ajustes operacionais;
- cards com glassmorphism, hierarquia clara e CTAs grandes;
- painel de qualidade, monitor técnico, health check e diagnóstico.

```bash
cd examples/softphone
npm install
npm run dev
```

---

## Compatibilidade com API antiga

```ts
await client.register();
await client.call({ destination: '4002' });
await client.answer(invitation, {});
await client.unregister();
```

Callbacks antigos continuam disponíveis, mas para código novo prefira `client.on(...)` e `session.on(...)`.
