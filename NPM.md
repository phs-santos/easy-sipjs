# easy-sipjs

Uma camada de abstração de alto nível e unificada sobre **SIP.js** e **JsSIP**. Projetada especificamente para eliminar o boilerplate exaustivo em aplicações WebRTC de produção, garantindo uma API consistente, moderna e 100% agnóstica de provedor.

---

## Instalação

```bash
npm install easy-sipjs
```

---

## Recursos Principais

- 🔌 **Provedor Agnóstico**: Mude de SIP.js para JsSIP em tempo de execução sem mexer na sua UI.
- 🔀 **URI Auto-Normalizado**: Funciona passando `"4002"`, `"sip:4002"` ou `"4002@sip.dominio.com"`.
- 👥 **Multi-Chamadas (Stack)**: Rastreamento automático de múltiplas sessões simultâneas e sessão ativa (`activeSession`).
- 🔄 **Status Reativo**: Ciclo de estados integrado (`connecting` ➡️ `connected` ➡️ `registered`).
- 🛡️ **Helpers WebRTC**: Métodos prontos para solicitar permissões e listar dispositivos (câmeras, fones, caixas de som).
- 🎥 **Upgrade de Vídeo Mid-Call**: A vinculação de mídia se adapta automaticamente se você ligar a câmera durante a chamada.
- 🔊 **Speaker Selection**: Altere a saída de áudio usando SinkId nativamente.
- 💬 **DTMF**: Envio e recepção de tons via SIP INFO (`application/dtmf-relay`).

---

## Começo Rápido

### 1. Permissões e Dispositivos
```typescript
import { SipClient } from 'easy-sipjs';

// Solicitar microfone
await SipClient.requestPermissions({ audio: true });

// Listar alto-falantes
const speakers = await SipClient.getAudioOutputDevices();
console.log("Speakers:", speakers);
```

### 2. Inicialização & Registro
```typescript
const client = new SipClient({
  domain: "sip.meudominio.com",
  phone: "4001",
  secret: "minhasenhasecreta",
  server: "wss://rtc.meudominio.com:8089/ws"
}, {
  provider: 'sipjs' // ou 'jssip'
});

client.onConnectionStateChange = (state) => {
  console.log(`Status de Conexão: ${state}`);
};

await client.register();
```

### 3. Chamada de Saída & Entrada
```typescript
// Fazer chamada
const session = await client.call({
  destination: "4002",
  remoteElement: document.getElementById('remoteAudio') as HTMLMediaElement
});

// Receber e atender chamada
client.onUserAgent.onInvite = async (invitation) => {
  const session = await client.answer(invitation, {
    remoteElement: document.getElementById('remoteAudio') as HTMLMediaElement
  });
};
```

---

## Controle de Chamadas (`ISipSession`)

```typescript
session.mute();         // Muta microfone local
session.unmute();
session.muteVideo();    // Desliga câmera local
session.unmuteVideo();

await session.hold();   // Coloca em espera
await session.unhold();

await session.setAudioOutput("id-alto-falante"); // Muda saída de áudio
await session.sendDTMF("1");                    // Envia tom DTMF

await session.transfer("4003");                 // Transferência cega
await session.transfer(outraSessionAtiva);      // Transferência atendida

await session.bye();                            // Desconecta chamada
```

---

## Gerenciamento Multi-Linha no `SipClient`

```typescript
const calls = client.getSessions(); // Lista de chamadas em andamento
client.setActiveSession(calls[0]);   // Focar em uma chamada específica

client.mute();         // Executa mute na chamada em foco
await client.hangup(); // Desconecta chamada em foco
```

---

## Licença

MIT
