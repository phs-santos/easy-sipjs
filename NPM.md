# easy-sipjs

![npm version](https://img.shields.io/npm/v/easy-sipjs?color=ff79c6&logo=npm&style=for-the-badge)

Uma camada de abstração de alto nível e simplificada sobre o [SIP.js](https://sipjs.com/), projetada para reduzir drasticamente o boilerplate em aplicações WebRTC e focar na experiência do desenvolvedor.

## Instalação

```bash
npm install easy-sipjs
```

## Início Rápido

### 1. Registro

```typescript
import { SipClient } from 'easy-sipjs';

const client = new SipClient({
  domain: "seu-dominio.com",
  phone: "4001",
  secret: "sua-senha",
  server: "wss://seu-servidor-wss:8089/ws"
});

await client.register();
```

### 2. Fazendo uma Chamada (Áudio/Vídeo)

```typescript
const session = await client.call({
  destination: "sip:4002@seu-dominio.com",
  remoteElement: document.getElementById('remoteVideo'),
  localElement: document.getElementById('localVideo'), // Opcional
  video: true
});
```

### 3. Controles de Mídia & DTMF

```typescript
session.mute();
session.hold();
await session.sendDTMF('1');
```

## Resumo da API

### SipClient
- `register()`: Handshake com o PBX.
- `call(options)`: Inicia uma nova sessão.
- `answer(invitation, options)`: Atende uma chamada recebida.
- `onSipLog`: Callback para logs brutos de sinalização SIP.

### ISipSession
- `mute()` / `unmute()`: Controle de microfone.
- `muteVideo()` / `unmuteVideo()`: Controle de câmera.
- `hold()` / `unhold()`: Colocar em espera (RFC 6337).
- `sendDTMF(tone)`: Envia tons via SIP INFO (dtmf-relay).
- `bye()`: Encerra a sessão.

## Licença

MIT
