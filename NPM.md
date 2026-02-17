# easy-sipjs

![npm version](https://img.shields.io/npm/v/easy-sipjs?color=ff79c6&logo=npm&style=for-the-badge)

A high-level, simplified abstraction layer for [SIP.js](https://sipjs.com/), designed to drastically reduce boilerplate in WebRTC applications and focus on developer experience.

## Installation

```bash
npm install easy-sipjs
```

## Quick Start

### 1. Registration

```typescript
import { SipClient } from 'easy-sipjs';

const client = new SipClient({
  domain: "your-domain.com",
  phone: "4001",
  secret: "your-password",
  server: "wss://your-wss-server:8089/ws"
});

await client.register();
```

### 2. Making a Call (Audio/Video)

```typescript
const session = await client.call({
  destination: "sip:4002@your-domain.com",
  remoteElement: document.getElementById('remoteVideo'),
  localElement: document.getElementById('localVideo'), // Optional
  video: true
});
```

### 3. Media Controls & DTMF

```typescript
session.mute();
session.hold();
await session.sendDTMF('1');
```

## API Summary

### SipClient
- `register()`: Handshake with the PBX.
- `call(options)`: Initiates a new session.
- `answer(invitation, options)`: Answers an incoming call.
- `onSipLog`: Callback for raw SIP signaling traces.

### ISipSession
- `mute()` / `unmute()`: Microfone control.
- `muteVideo()` / `unmuteVideo()`: Camera control.
- `hold()` / `unhold()`: Session hold (RFC 6337).
- `sendDTMF(tone)`: Sends tones via SIP INFO (dtmf-relay).
- `bye()`: Terminates the session.

## License

MIT
