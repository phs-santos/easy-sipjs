# easy-sipjs (v2.1.1)

![npm version](https://img.shields.io/npm/v/easy-sipjs?color=ff79c6&logo=npm&style=for-the-badge)

Uma camada de abstração de alto nível e simplificada sobre o [SIP.js](https://sipjs.com/), projetada para reduzir drasticamente o boilerplate em aplicações WebRTC e focar na experiência do desenvolvedor.

## ✨ Principais Funcionalidades

- **Registro Simplificado**: Conecta e registra no seu PBX com apenas um comando.
- **Gestão Semântica de Chamadas**: Métodos intuitivos para `call`, `answer`, `reject` e `bye`.
- **Múltiplas Chamadas (Multi-Call)**: Gerenciamento robusto de várias sessões simultâneas.
- **Controles de Mídia**: Suporte nativo para **Mute/Unmute** e **Hold/Unhold** (com re-INVITE SDP via RFC 6337).
- **Auto-Hold Inteligente**: Lógica para colocar chamadas em espera automaticamente ao alternar linhas.
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
  destination: "sip:4002@seu-dominio.com",
  remoteElement: document.getElementById('remoteAudio'), // Elemento <audio> para o som remoto
  video: false
});

// Encerrar chamada
await session.bye();
```

### 3. Recebendo Chamadas

```typescript
client.onUserAgent.onInvite = async (invitation) => {
  console.log("Chamada de:", invitation.remoteIdentity.uri.user);
  
  // Para atender:
  const session = await client.answer(invitation, {
    remoteElement: document.getElementById('remoteAudio')
  });
  
  // Ou para rejeitar:
  await invitation.reject();
};
```

### 🎮 Playground Integreado
Para testar a biblioteca em tempo real com uma interface Dracula Premium:
```bash
cd examples/demo
npm install
npm run dev
```

### 4. Controles de Mídia (Mute & Hold)

O `easy-sipjs` gerencia o estado do SDP e das faixas de áudio para você.

```typescript
// Mutar microfone
session.mute();

// Retomar áudio
session.unmute();

// Colocar em espera (Envia re-INVITE e pausa áudio)
await session.hold();

// Retomar da espera
await session.unhold();
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

## 🤝 Contribuindo

Contribuições são fundamentais para a evolução do projeto! 

1. Faça um fork do repositório.
2. Crie seu branch funcional (`git checkout -b feature/minha-melhoria`).
3. Commit suas alterações (`git commit -m 'feat: nova funcionalidade'`).
4. Push para o branch (`git push origin feature/minha-melhoria`).
5. Abra um Pull Request.

## 📄 Licença

Este projeto está licenciado sob a licença MIT - veja o arquivo [LICENSE](LICENSE) para detalhes.

## 🛠 Suporte

Dúvidas ou problemas?
- Abra uma [Issue](https://github.com/phs-santos/easy-sipjs/issues)
- Desenvolvido por [phs-santos](https://github.com/phs-santos)