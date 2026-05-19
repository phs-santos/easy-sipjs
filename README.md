# easy-sipjs (v2.3.1)

![npm version](https://img.shields.io/npm/v/easy-sipjs?color=ff79c6&logo=npm&style=for-the-badge)
![license](https://img.shields.io/npm/l/easy-sipjs?color=50fa7b&style=for-the-badge)

Uma camada de abstração de alto nível e unificada sobre **SIP.js** e **JsSIP**. Projetada especificamente para eliminar o boilerplate exaustivo em aplicações WebRTC de produção, garantindo uma API consistente, moderna e 100% agnóstica de provedor.

---

## ⚡ Principais Funcionalidades

- 🔌 **Multi-Provider Transparente**: Alterne entre os motores **SIP.js** e **JsSIP** em tempo de execução sem alterar uma única linha do código da sua UI.
- 🔀 **Normalização Inteligente de URI**: Esqueça a bagunça dos prefixos `sip:`. A biblioteca normaliza os destinos automaticamente para ambos os provedores.
- 👥 **Gerenciamento de Multi-Chamadas (Session Stack)**: Suporte nativo a múltiplos canais simultâneos com rastreamento de sessão ativa (`activeSession`), facilitando cenários de retenção, transferência e alternância de linhas.
- 🔄 **Conexão Resiliente e Reativa**: Acompanhe o status da conexão em tempo real com o novo ciclo de estados (`connecting` ➡️ `connected` ➡️ `registered`).
- 🛡️ **WebRTC Media Helpers**: Solicite permissões de áudio/vídeo e liste dispositivos de entrada (microfones/câmeras) e saída (alto-falantes) com métodos estáticos prontos para uso.
- 🎥 **Upgrades Dinâmicos de Vídeo (Mid-Call)**: Atualizações de faixas de mídia (como ativar câmera no meio de uma chamada de voz) se refletem na tela automaticamente via escuta ativa do `RTCPeerConnection`.
- 🎛️ **Controles de Mídia Semânticos**: Controle total sobre **Mute/Unmute** (áudio/vídeo), **Hold/Unhold** e **Transferência** (atendida ou cega).
- 🔊 **Seleção de Alto-Falante (SinkId)**: Mude a saída de áudio da chamada dinamicamente com suporte a `setSinkId`.
- 💬 **Sinalização DTMF**: Envio e recebimento nativo de tons via SIP INFO (`application/dtmf-relay`).
- 🌐 **Suporte a STUN/TURN (Traversal NAT) [Novo!]**: Configure servidores ICE de forma nativa e agnóstica em ambos os provedores.
- ✉️ **Cabeçalhos SIP Customizados (Extra Headers) [Novo!]**: Envie cabeçalhos SIP personalizados nas chamadas e no atendimento (`CallOptions` e `AnswerOptions`).
- 🔌 **Reconexão Resiliente Automática [Novo!]**: Monitora ativamente quedas de rede e WebSocket, engajando um loop de reconexão automática e sincronia com eventos online do browser.
- 🔔 **Tons de Chamada Automatizados (Ringtones) [Novo!]**: Ciclo de vida completo para sons de chamada recebida (Ringtone) e de saída (Ringback) de forma 100% nativa.

---

## 📦 Instalação

```bash
npm install easy-sipjs
```

### Importação Direta (Navegador/CDN)
```html
<!-- Importação via Script Global -->
<script src="https://unpkg.com/easy-sipjs/dist/easy-sip.min.js"></script>
<script>
  const client = new EasySip.SipClient({ ... });
</script>

<!-- Importação via Módulos ESM -->
<script type="module">
  import { SipClient } from 'https://esm.sh/easy-sipjs';
  const client = new SipClient({ ... });
</script>
```

---

## 🚀 Guia de Uso Prático

### 1. Solicitar Permissões e Enumerar Dispositivos (Helpers)
Evite escrever boilerplate extra de browser. O `SipClient` faz isso para você:

```typescript
import { SipClient } from 'easy-sipjs';

// Solicitar acesso ao microfone (e câmera opcionalmente)
const hasPermission = await SipClient.requestPermissions({ audio: true, video: false });

if (hasPermission) {
  // Listar dispositivos de saída disponíveis (alto-falantes/fones)
  const speakers = await SipClient.getAudioOutputDevices();
  console.log("Dispositivos de saída:", speakers);
}
```

### 2. Configurar o Cliente e Registrar o Ramal
Configure opcionalmente servidores STUN/TURN, tons de chamada e acompanhe o status:

```typescript
const client = new SipClient({
  domain: "sip.meudominio.com",
  phone: "4001",
  secret: "minhasenhasecreta",
  server: "wss://rtc.meudominio.com:8089/ws",
  // 1. Suporte a STUN/TURN nativo (Agnóstico de Provedor)
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "turn:turn.meudominio.com:3478", username: "user", credential: "pwd" }
  ]
}, {
  provider: 'jssip', // Escolha 'sipjs' (padrão) ou 'jssip'
  // 2. Tons de chamada integrados (Ringtone & Ringback)
  sounds: {
    ringtone: "/sounds/incoming-ring.mp3",
    ringback: "/sounds/outgoing-calling.mp3"
  }
});

// Acompanhar o estado de conexão e reconexão reativa de rede
client.onConnectionStateChange = (state) => {
  console.log(`Estado da Conexão: ${state}`); 
  // Estados possíveis: 'connecting' | 'connected' | 'registered' | 'disconnected' | 'error'
};

// Iniciar conexão com o PBX (A reconexão ativa cuidará de quedas de rede de forma transparente)
await client.register();
```

### 3. Gerenciamento e Controle de Chamadas

#### Fazendo uma Chamada de Saída (Normalização e Extra Headers)
```typescript
// O tom de Ringback configurado começará a tocar e parará automaticamente no atendimento
const session = await client.call({
  destination: "4002", 
  remoteElement: document.getElementById('remoteAudio') as HTMLMediaElement,
  localElement: document.getElementById('localAudio') as HTMLMediaElement, // Opcional
  video: false,
  // 3. Enviar cabeçalhos customizados na sinalização SIP
  extraHeaders: ["X-Agent-ID: 102", "X-Queue-Code: support"]
});

console.log("ID da Sessão:", session.id);
```

#### Recebendo e Atendendo Chamadas
```typescript
client.onUserAgent.onInvite = async (invitation) => {
  // O som de Ringtone tocará automaticamente até que a chamada seja aceita, rejeitada ou encerrada
  console.log(`Chamada recebida de: ${invitation.remoteIdentity.displayName}`);
  
  // Atender chamada com elementos de mídia e cabeçalhos opcionais
  const session = await client.answer(invitation, {
    remoteElement: document.getElementById('remoteAudio') as HTMLMediaElement,
    video: false,
    extraHeaders: ["X-Answered-By: WebRTCApp"]
  });
  
  session.onConfirm = () => {
     console.log("Chamada confirmada/atendida pelo outro lado!");
  };

  session.onTerminate = () => {
    console.log("A chamada foi encerrada.");
  };
};
```

---

## 🎛️ Operações em Chamadas Ativas (`ISipSession`)

Uma vez obtida a instância da sessão (`ISipSession`), todas as ações de mídia e sinalização tornam-se de altíssimo nível:

```typescript
// 1. Controle de Microfone e Câmera
session.mute();       // Silencia o microfone local
session.unmute();     // Ativa o microfone local
session.muteVideo();  // Desativa a transmissão da câmera local
session.unmuteVideo();

// 2. Retenção de Chamada (Espera/Hold)
await session.hold();   // Envia SDP sendonly e silencia a faixa local
await session.unhold(); // Retoma o fluxo bidirecional de mídia

// 3. Alteração Dinâmica de Saída de Áudio (Speaker Switcher)
await session.setAudioOutput("id-do-dispositivo-selecionado");

// 4. Envio de Tons DTMF
await session.sendDTMF("5");

// 5. Transferência de Chamada (Blind ou Attended)
await session.transfer("4003"); // Transferência cega para outro ramal
await session.transfer(outraSessionAtiva); // Transferência atendida entre duas linhas ativas

// 6. Encerrar
await session.bye();
```

---

## 👥 Gerenciando Múltiplas Chamadas Simultâneas

Se a sua aplicação permite múltiplos canais de chamada ativos ao mesmo tempo, o `SipClient` cuida disso:

```typescript
// Obter lista de sessões em andamento
const activeCalls = client.getSessions();

// Definir qual linha está atualmente em foco na tela
client.setActiveSession(activeCalls[0]);

// Métodos de atalho no SipClient operam sempre sobre a activeSession atual:
client.mute();   // Muta a sessão focada
await client.hangup(); // Encerra a chamada em foco
```

---

## 🔬 Depuração Profunda (Protocol Trace)

Capture as mensagens SIP brutas (INVITE, BYE, 200 OK) trafegando no canal WebSocket para facilitar a análise:

```typescript
client.onSipLog = (level, category, label, content) => {
  if (category === "sip.Transport") {
    console.log("[SIP Signal Log]:", content);
  }
};
```

---

## 🎮 Playground Integrado

Quer ver a biblioteca funcionando em tempo real? O repositório contém uma aplicação React/TypeScript estilizada em **Dracula Premium** com logs integrados:

```bash
cd examples/demo
npm install
npm run dev
```

---

## 📄 Licença

Este projeto está licensed sob a licença **MIT**.

---

## 🛠 Autor e Suporte

Desenvolvido e mantido com ❤️ por [phs-santos](https://github.com/phs-santos).