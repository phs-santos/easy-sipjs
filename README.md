# easy-sipjs

![npm version](https://img.shields.io/npm/v/easy-sipjs?color=ff79c6&logo=npm&style=for-the-badge)

Uma camada de abstração de alto nível e simplificada sobre o [SIP.js](https://sipjs.com/), projetada para reduzir drasticamente o boilerplate em aplicações WebRTC e focar na experiência do desenvolvedor.

## ✨ Principais Funcionalidades

- **Registro Simplificado**: Conecta e registra no seu PBX com apenas um comando.
- **Gestão Semântica de Chamadas**: Métodos intuitivos para `call`, `answer`, `reject` e `bye`.
- **Múltiplas Chamadas (Multi-Call)**: Gerenciamento robusto de várias sessões simultâneas.
- **Controles de Mídia**: Suporte nativo para **Mute/Unmute**, **MuteVideo/UnmuteVideo** e **Hold/Unhold** (com re-INVITE SDP via RFC 6337).
- **Auto-Hold Inteligente**: Lógica para colocar chamadas em espera automaticamente ao alternar linhas.
- **Suporte a Saída de Áudio**: Seleção de dispositivos de saída (alto-falantes/fones) via `setSinkId`.
- **Suporte a DTMF**: Envio e recebimento de tons via sinalização INFO (dtmf-relay).
- **Protocol Trace**: Capture logs de sinalização WSS/SIP brutos para depuração profunda.

## 📦 Instalação

```bash
npm install easy-sipjs
```

## 🚀 Guia de Uso Rápido

### 1. Instanciamento e Registro

```typescript
import { SipClient } from 'easy-sipjs';

const client = new SipClient({
  domain: "seu-dominio.com",
  phone: "4001",
  secret: "sua-senha",
  server: "wss://seu-servidor-wss:8089/ws"
});

// Registrar o ramal
await client.register();

client.onRegister.onAccept = () => console.log("Online e pronto! 🎉");
```

### 2. Fazendo uma Chamada

```typescript
const session = await client.call({
  destination: "4002",
  remoteElement: document.getElementById('remoteVideo'),
  video: true
});

// Enviar DTMF
await session.sendDTMF('1');

// Encerrar chamada
await session.bye();
```

### 🎮 Playground Integrado
Para testar a biblioteca em tempo real com uma interface Dracula Premium:
```bash
cd examples/demo
npm install
npm run dev
```

## 🧪 Depuração (Protocol Trace)

Habilite a interceptação de logs para ver as mensagens SIP (INVITE, BYE, etc) trafegando no WebSocket:

```typescript
client.onSipLog = (level, category, label, content) => {
  if (category === "sip.Transport") {
    console.log("SIP Message:", content);
  }
};
```

## 📄 Licença

Este projeto está licenciado sob a licença MIT.

## 🛠 Suporte

- Desenvolvido por [phs-santos](https://github.com/phs-santos)