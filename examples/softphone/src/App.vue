<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch, type Component } from "vue";
import {
  Activity, AlertTriangle, ArrowDownLeft, ArrowRightLeft, ArrowUpRight, BarChart2,
  Clock, Delete, Hash, LogOut, MessageSquare, Mic, MicOff, Monitor as MonitorIcon,
  Pause, Phone, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOff, Play, RefreshCw,
  Send, Settings, ShieldCheck, Signal, Sparkles, Terminal, Trash2, User, Volume2,
  VolumeX, Wifi, X,
} from "lucide-vue-next";
import { SipClient } from "easy-sipjs";
import type {
  CallQualitySnapshot,
  CallStats,
  ISipSession,
  SipConnectionState,
  SipHealthStatus,
  SipInvitation,
  SoftphoneDiagnostics,
  SoftphoneDevice,
} from "easy-sipjs";
import { useLocalStorage } from "./composables/useLocalStorage";
import type { ActiveView, CallRecord, DevicePrefs, MessageRecord, SipLogEntry, StoredCredentials } from "./types";
import MonitorCards from "./components/MonitorCards.vue";
import SipTrace from "./components/SipTrace.vue";

interface CallerInfo { number: string; name?: string; }
interface SessionState {
  session: ISipSession;
  isMuted: boolean;
  isOnHold: boolean;
  isSharingScreen: boolean;
  callRecordId: string;
}

const credentials = useLocalStorage<StoredCredentials | null>("sp:credentials", null);
const devicePrefs = useLocalStorage<DevicePrefs>("sp:device-prefs", {});
const callHistory = useLocalStorage<CallRecord[]>("sp:history", []);
const messages = useLocalStorage<MessageRecord[]>("sp:messages", []);

const activeView = ref<ActiveView>("dialer");
const connectionState = ref<SipConnectionState>("disconnected");
const sessionStates = ref<SessionState[]>([]);
const activeSessionId = ref<string>();
const invitation = shallowRef<SipInvitation>();
const callerInfo = ref<CallerInfo>();
const sipLogs = ref<SipLogEntry[]>([]);
const callEndReason = ref<string | null>(null);
const client = shallowRef<SipClient>();
const remoteAudio = new Audio();
remoteAudio.autoplay = true;
const intentionalHangups = new Set<string>();

const dialValue = ref("");
const messageTo = ref("");
const messageBody = ref("");
const showDtmf = ref(false);
const transferTarget = ref("");
const newCallTarget = ref("");
const volume = ref(1);
const stats = ref<CallStats>();
const quality = ref<CallQualitySnapshot>();
const isHangingUp = ref(false);
const health = ref<SipHealthStatus>();
const diagnostics = ref<SoftphoneDiagnostics>();
const devices = ref<SoftphoneDevice[]>([]);
const settingsForm = ref<StoredCredentials | null>(null);
const loginForm = ref<StoredCredentials>({
  domain: "pxoffice.pxtalk.com.br",
  phone: "5001",
  secret: "",
  authorizationUsername: "",
  server: "wss://phone-rtc.pxtalk.com.br:4443/ws",
  provider: "sipjs",
  debug: true,
});
const loginError = ref("");

const digits = [
  { digit: "1" }, { digit: "2", letters: "ABC" }, { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" }, { digit: "5", letters: "JKL" }, { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" }, { digit: "8", letters: "TUV" }, { digit: "9", letters: "WXYZ" },
  { digit: "*" }, { digit: "0", letters: "+" }, { digit: "#" },
];
const dtmfDigits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

const navItems: Array<{ id: ActiveView; label: string; hint: string; icon: Component }> = [
  { id: "dialer", label: "Discador", hint: "Ligações", icon: Phone },
  { id: "history", label: "Histórico", hint: "Registro", icon: Clock },
  { id: "messages", label: "Mensagens", hint: "SIP MESSAGE", icon: MessageSquare },
  { id: "monitor", label: "Monitor", hint: "Saúde", icon: Activity },
  { id: "settings", label: "Ajustes", hint: "Áudio", icon: Settings },
];


const activeSessionState = computed(() => sessionStates.value.find(s => s.session.id === activeSessionId.value));
const unreadMessages = computed(() => messages.value.filter(m => !m.read).length);
const isRegistered = computed(() => connectionState.value === "registered");
const title = computed(() => ({
  dialer: "Central de chamadas",
  history: "Histórico de chamadas",
  messages: "Mensagens SIP",
  settings: "Ajustes do softphone",
  monitor: "Monitor técnico",
}[activeView.value]));

const statusLabel = computed(() => ({
  registered: "Pronto para ligar",
  connected: "Conectado",
  connecting: "Conectando…",
  disconnected: "Desconectado",
  error: "Atenção necessária",
}[connectionState.value]));

const visibleLogs = computed(() => sipLogs.value.slice(0, 80));

function uid() {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(seconds: number) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function rejectMessage(code: number) {
  switch (code) {
    case 486: return "Ocupado — destino rejeitou a chamada";
    case 480: return "Temporariamente indisponível";
    case 404: return "Número não encontrado";
    case 403: return "Acesso negado";
    case 503: return "Serviço indisponível";
    case 408: return "Sem resposta (timeout)";
    default: return code ? `Chamada encerrada (${code})` : "Chamada não atendida";
  }
}

function createClient(creds: StoredCredentials) {
  const next = new SipClient(creds, {
    preset: "asterisk",
    provider: creds.provider || "sipjs",
    healthCheckIntervalMs: 30000,
    sounds: {
      ringtone: devicePrefs.value.ringtone || undefined,
      ringback: devicePrefs.value.ringback || undefined,
    },
  });

  next.onConnectionStateChange = state => {
    connectionState.value = state;
  };

  next.onSipLog = (_level, _category, _label, content) => pushSipLog(content);
  next.on("invite", handleInvite);
  next.on("message", handleMessage);

  return next;
}

async function startClient() {
  if (!credentials.value) return;
  await stopClient();
  settingsForm.value = { ...credentials.value };
  client.value = createClient(credentials.value);
  await client.value.connect().catch(error => console.error("[softphone] connect failed:", error));
}

async function stopClient() {
  if (!client.value) return;
  await client.value.disconnect().catch(() => undefined);
  client.value = undefined;
  sessionStates.value = [];
  activeSessionId.value = undefined;
}

function pushSipLog(content: string) {
  let direction: "sent" | "received" | null = null;
  let sipMessage = "";

  if (content.includes("Sending WebSocket message:")) {
    direction = "sent";
    sipMessage = content.replace(/^[\s\S]*?Sending WebSocket message:\s*\n+/, "").trim();
  } else if (content.includes("Received WebSocket") && content.includes("message:")) {
    direction = "received";
    sipMessage = content.replace(/^[\s\S]*?Received WebSocket[^\n]*message:\s*\n+/, "").trim();
  }

  if (!direction || !sipMessage) return;

  const firstLine = sipMessage.split(/\r?\n/)[0]?.trim() ?? "";
  let method: string | undefined;
  let statusCode: number | undefined;
  let statusText: string | undefined;

  if (firstLine.startsWith("SIP/2.0 ")) {
    const parts = firstLine.slice(8).split(" ");
    statusCode = Number.parseInt(parts[0] ?? "", 10);
    statusText = parts.slice(1).join(" ");
  } else {
    method = firstLine.split(" ")[0];
    if (!method || !/^[A-Z]{2,10}$/.test(method)) return;
  }

  sipLogs.value = [{ id: uid(), timestamp: Date.now(), direction, method, statusCode, statusText, content: sipMessage }, ...sipLogs.value].slice(0, 200);
}

function handleInvite(inv: SipInvitation) {
  const number = inv.remoteIdentity.uri.user;
  const name = inv.remoteIdentity.displayName || undefined;
  invitation.value = inv;
  callerInfo.value = { number, name };

  const previousTerminate = inv.onTerminate;
  inv.onTerminate = () => {
    invitation.value = undefined;
    callerInfo.value = undefined;
    previousTerminate?.();
  };
}

function handleMessage(raw: any) {
  const body = raw?.body || raw?.data?.body || String(raw);
  const from = raw?.from?.uri?.user || raw?.remote_identity?.uri?.user || "unknown";
  const record: MessageRecord = { id: uid(), direction: "inbound", peer: from, body, timestamp: new Date().toISOString(), read: false };
  messages.value = [record, ...messages.value].slice(0, 500);
}

function addCallRecord(record: CallRecord) {
  callHistory.value = [record, ...callHistory.value].slice(0, 200);
}

function updateCallRecord(id: string, patch: Partial<CallRecord>) {
  callHistory.value = callHistory.value.map(record => record.id === id ? { ...record, ...patch } : record);
}

function cleanupSessionUi(ss: SessionState) {
  intentionalHangups.delete(ss.session.id);
  try {
    remoteAudio.pause();
    remoteAudio.srcObject = null;
  } catch {}

  const duration = ss.session.getCallDuration();
  updateCallRecord(ss.callRecordId, {
    endedAt: new Date().toISOString(),
    duration,
    ...(duration > 0 ? { status: "answered" as const } : {}),
  });

  sessionStates.value = sessionStates.value.filter(item => item.session.id !== ss.session.id);
  if (activeSessionId.value === ss.session.id) {
    activeSessionId.value = sessionStates.value.at(-1)?.session.id;
  }
}

function wireSession(session: ISipSession, direction: "inbound" | "outbound", peer: string, displayName?: string) {
  const recordId = uid();

  addCallRecord({
    id: recordId,
    direction,
    number: peer,
    displayName,
    startedAt: new Date().toISOString(),
    duration: 0,
    status: direction === "outbound" ? "calling" : "answered",
  });

  const ss: SessionState = { session, isMuted: false, isOnHold: false, isSharingScreen: false, callRecordId: recordId };

  const previousConfirm = session.onConfirm;
  session.onConfirm = () => {
    previousConfirm?.();
    updateCallRecord(recordId, { status: "answered" });
    activeSessionId.value = session.id;
    if (devicePrefs.value.audioOutput) session.setAudioOutput(devicePrefs.value.audioOutput).catch(() => undefined);
    if (devicePrefs.value.audioInput) session.setAudioInput(devicePrefs.value.audioInput).catch(() => undefined);
  };

  const previousHold = session.onHold;
  session.onHold = () => {
    previousHold?.();
    const target = sessionStates.value.find(item => item.session.id === session.id);
    if (target) target.isOnHold = true;
  };

  const previousUnhold = session.onUnhold;
  session.onUnhold = () => {
    previousUnhold?.();
    const target = sessionStates.value.find(item => item.session.id === session.id);
    if (target) target.isOnHold = false;
  };

  const previousReject = session.onReject;
  session.onReject = (statusCode: number) => {
    previousReject?.(statusCode);
    if (intentionalHangups.has(session.id)) return;
    updateCallRecord(recordId, { status: statusCode === 486 ? "busy" : "failed" });
    showCallEndReason(rejectMessage(statusCode));
  };

  const previousTerminate = session.onTerminate;
  session.onTerminate = () => {
    previousTerminate?.();
    cleanupSessionUi(ss);
  };

  sessionStates.value = [...sessionStates.value, ss];
  activeSessionId.value = session.id;
}

function showCallEndReason(message: string) {
  callEndReason.value = message;
  window.setTimeout(() => {
    if (callEndReason.value === message) callEndReason.value = null;
  }, 4200);
}

async function connectFromLogin() {
  loginError.value = "";
  if (!loginForm.value.domain || !loginForm.value.phone || !loginForm.value.secret || !loginForm.value.server) {
    loginError.value = "Preencha domínio, ramal, senha e servidor WebSocket.";
    return;
  }
  credentials.value = { ...loginForm.value };
  await nextTick();
  await startClient();
}

async function logout() {
  await stopClient();
  credentials.value = null;
}

async function dial() {
  const destination = dialValue.value.trim();
  if (!destination || !client.value) return;
  const session = await client.value.call({ destination, remoteElement: remoteAudio });
  wireSession(session, "outbound", destination);
  dialValue.value = "";
}

async function answerIncoming() {
  if (!client.value || !invitation.value) return;
  if (activeSessionState.value && !activeSessionState.value.isOnHold) {
    await activeSessionState.value.session.hold().catch(() => undefined);
  }
  const number = invitation.value.remoteIdentity.uri.user;
  const name = invitation.value.remoteIdentity.displayName || undefined;
  const session = await client.value.answer(invitation.value, { remoteElement: remoteAudio });
  wireSession(session, "inbound", number, name);
  invitation.value = undefined;
  callerInfo.value = undefined;
}

async function rejectIncoming() {
  if (!invitation.value) return;
  const number = invitation.value.remoteIdentity.uri.user;
  await invitation.value.reject();
  addCallRecord({ id: uid(), direction: "inbound", number, displayName: invitation.value.remoteIdentity.displayName || undefined, startedAt: new Date().toISOString(), duration: 0, status: "rejected" });
  invitation.value = undefined;
  callerInfo.value = undefined;
}

async function hangup() {
  const active = activeSessionState.value;
  if (!active || isHangingUp.value) return;
  isHangingUp.value = true;
  intentionalHangups.add(active.session.id);

  try {
    await Promise.race([
      active.session.bye(),
      new Promise<void>(resolve => window.setTimeout(resolve, 1800)),
    ]);
  } catch (error) {
    console.error("[softphone] hangup failed:", error);
  } finally {
    cleanupSessionUi(active);
    isHangingUp.value = false;
  }
}

async function toggleMute() {
  const active = activeSessionState.value;
  if (!active) return;
  active.isMuted ? active.session.unmute() : active.session.mute();
  active.isMuted = !active.isMuted;
}

async function toggleHold() {
  const active = activeSessionState.value;
  if (!active) return;
  active.isOnHold ? await active.session.unhold() : await active.session.hold();
}

async function sendDtmf(tone: string) {
  await activeSessionState.value?.session.sendDTMF(tone);
}

async function transferCall() {
  const target = transferTarget.value.trim();
  if (!target) return;
  await activeSessionState.value?.session.transfer(target);
  transferTarget.value = "";
}

async function makeNewCall() {
  const target = newCallTarget.value.trim();
  if (!target) return;
  if (activeSessionState.value && !activeSessionState.value.isOnHold) {
    await activeSessionState.value.session.hold().catch(() => undefined);
  }
  dialValue.value = target;
  newCallTarget.value = "";
  await dial();
}

async function toggleScreenShare() {
  const active = activeSessionState.value;
  if (!active) return;
  if (active.isSharingScreen) {
    await active.session.stopScreenSharing();
    active.isSharingScreen = false;
  } else {
    await active.session.shareScreen();
    active.isSharingScreen = true;
  }
}

function setVolume() {
  activeSessionState.value?.session.setRemoteVolume(volume.value);
}

async function refreshStats() {
  if (!activeSessionState.value) return;
  stats.value = await activeSessionState.value.session.getStats();
  quality.value = await activeSessionState.value.session.getQuality();
}

async function runHealth() {
  if (!client.value) return;
  health.value = await client.value.checkHealth();
}

async function runDiagnostics() {
  if (!client.value) return;
  diagnostics.value = await client.value.diagnose();
}

async function requestDevices() {
  if (!client.value) return;
  await client.value.devices.requestPermissions({ audio: true, video: false });
  devices.value = await client.value.devices.list();
}

async function saveSettings() {
  if (!settingsForm.value) return;
  credentials.value = { ...settingsForm.value };
  await startClient();
}

async function saveDevices() {
  if (activeSessionState.value) {
    if (devicePrefs.value.audioInput) await activeSessionState.value.session.setAudioInput(devicePrefs.value.audioInput).catch(() => undefined);
    if (devicePrefs.value.audioOutput) await activeSessionState.value.session.setAudioOutput(devicePrefs.value.audioOutput).catch(() => undefined);
  }
}

async function sendMessage() {
  if (!client.value || !messageTo.value.trim() || !messageBody.value.trim()) return;
  const to = messageTo.value.trim();
  const body = messageBody.value.trim();
  await client.value.sendMessage(to, body);
  const record: MessageRecord = { id: uid(), direction: "outbound", peer: to, body, timestamp: new Date().toISOString(), read: true };
  messages.value = [record, ...messages.value].slice(0, 500);
  messageBody.value = "";
}

function switchSession(id: string) {
  activeSessionId.value = id;
}

watch(credentials, value => {
  if (value) startClient();
}, { immediate: true });

watch(activeSessionState, () => {
  stats.value = undefined;
  quality.value = undefined;
});

let statsTimer: number | undefined;
watch(activeSessionState, active => {
  if (statsTimer) window.clearInterval(statsTimer);
  if (!active) return;
  refreshStats();
  statsTimer = window.setInterval(refreshStats, 1600);
}, { immediate: true });

onBeforeUnmount(() => {
  if (statsTimer) window.clearInterval(statsTimer);
  stopClient();
});
</script>

<template>
  <div v-if="!credentials" class="min-h-dvh bg-soft-radial text-sp-text p-4 flex items-center justify-center overflow-y-auto">
    <div class="absolute inset-0 pointer-events-none opacity-40 bg-grid" />
    <section class="relative w-full max-w-5xl grid lg:grid-cols-[1fr_28rem] gap-6 items-center">
      <div class="hidden lg:block">
        <div class="inline-flex items-center gap-2 rounded-full border border-sp-blue/25 bg-sp-blue/10 px-4 py-2 text-xs uppercase tracking-[.22em] font-bold text-sp-blue">
          <ShieldCheck :size="14" /> WebRTC SDK
        </div>
        <h1 class="mt-5 text-5xl font-black leading-tight">Softphone pronto para demonstração.</h1>
        <p class="mt-4 text-sp-muted text-lg max-w-xl">Interface em Vue, fluxo simples para testar registro, chamadas, mensagens, trace SIP, diagnóstico e áudio.</p>
        <div class="mt-8 grid grid-cols-3 gap-3 max-w-xl">
          <div class="sp-card p-4"><Wifi class="text-sp-green mb-3" :size="22" /><strong>Registro</strong><p class="text-xs text-sp-muted mt-1">REGISTER, health check e reconnect.</p></div>
          <div class="sp-card p-4"><Signal class="text-sp-blue mb-3" :size="22" /><strong>Qualidade</strong><p class="text-xs text-sp-muted mt-1">Jitter, perda e RTT.</p></div>
          <div class="sp-card p-4"><Terminal class="text-sp-violet mb-3" :size="22" /><strong>Trace SIP</strong><p class="text-xs text-sp-muted mt-1">Logs seguros para suporte.</p></div>
        </div>
      </div>

      <form class="sp-card p-6 md:p-7" @submit.prevent="connectFromLogin">
        <div class="w-14 h-14 rounded-3xl bg-gradient-to-br from-sp-blue to-sp-green flex items-center justify-center shadow-glow mb-5">
          <Phone class="text-[#03131d]" :size="26" />
        </div>
        <h2 class="text-2xl font-black">Conectar ramal</h2>
        <p class="text-sm text-sp-muted mt-1 mb-5">Preencha os dados SIP para iniciar o teste.</p>

        <div class="space-y-3">
          <input v-model="loginForm.phone" class="sp-input" placeholder="Ramal" autocomplete="username" />
          <input v-model="loginForm.secret" class="sp-input" placeholder="Senha SIP" type="password" autocomplete="current-password" />
          <input v-model="loginForm.domain" class="sp-input" placeholder="Domínio SIP" />
          <input v-model="loginForm.server" class="sp-input" placeholder="WebSocket WSS" />
          <input v-model="loginForm.authorizationUsername" class="sp-input" placeholder="Usuário de auth opcional" />
          <select v-model="loginForm.provider" class="sp-input"><option value="sipjs">SIP.js</option><option value="jssip">JsSIP</option></select>
        </div>

        <p v-if="loginError" class="mt-3 text-sm text-sp-red">{{ loginError }}</p>
        <button class="mt-5 w-full sp-button-primary py-4 flex items-center justify-center gap-2"><PhoneCall :size="18" /> Conectar softphone</button>
      </form>
    </section>
  </div>

  <div v-else class="h-dvh bg-soft-radial text-sp-text overflow-hidden">
    <div class="absolute inset-0 pointer-events-none opacity-45 bg-grid" />
    <div class="relative flex h-full min-h-0">
      <aside class="w-[17rem] hidden md:flex flex-col border-r border-white/10 bg-[#07111f]/82 backdrop-blur-2xl min-h-0">
        <div class="p-5 border-b border-white/10">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl bg-gradient-to-br from-sp-blue to-sp-green flex items-center justify-center shadow-glow">
              <Phone :size="20" class="text-[#03131d]" />
            </div>
            <div><span class="font-black text-sp-text text-lg leading-none">SoftPhone</span><div class="text-[10px] text-sp-muted uppercase tracking-[0.18em] font-bold mt-1">Vue WebRTC SDK</div></div>
          </div>
          <div class="mt-5 sp-panel p-3">
            <div class="flex items-center gap-2 text-xs">
              <span :class="['sp-status-dot', isRegistered ? 'bg-sp-green text-sp-green' : 'bg-sp-amber text-sp-amber']" />
              <span :class="['font-bold', isRegistered ? 'text-sp-green' : 'text-sp-amber']">{{ statusLabel }}</span>
            </div>
            <div class="text-sp-text text-sm font-semibold mt-2 truncate">{{ credentials.nameexten || credentials.phone }}</div>
            <div class="text-[11px] text-sp-muted truncate">Ramal {{ credentials.phone }}</div>
          </div>
        </div>

        <nav class="p-3 space-y-2 flex-1">
          <button v-for="item in navItems" :key="item.id" class="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all" :class="activeView === item.id ? 'bg-sp-blue/10 border border-sp-blue/35 text-sp-text shadow-glow' : 'text-sp-muted hover:text-sp-text hover:bg-white/[0.04]'" @click="activeView = item.id">
            <component :is="item.icon" :size="17" class="text-sp-blue" />
            <span><strong class="block text-sm">{{ item.label }}</strong><small class="text-[11px] text-sp-muted">{{ item.hint }}</small></span>
            <span v-if="item.id === 'messages' && unreadMessages" class="ml-auto bg-sp-red text-white rounded-full text-[10px] px-1.5 py-0.5">{{ unreadMessages }}</span>
          </button>
        </nav>

        <div class="p-4 border-t border-white/10 space-y-3">
          <div class="sp-panel p-3 text-xs text-sp-muted"><Sparkles :size="15" class="text-sp-blue inline mr-1" /> Pronto para demonstração</div>
          <button class="flex items-center gap-2 text-sp-muted hover:text-sp-red transition-colors px-2 py-2" @click="logout"><LogOut :size="16" /> Desconectar</button>
        </div>
      </aside>

      <main class="flex-1 min-w-0 overflow-hidden p-3 md:p-4 lg:p-5">
        <header class="sp-card px-4 py-3 md:px-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div class="flex items-center gap-2 text-xs text-sp-muted uppercase tracking-[0.22em] font-semibold"><ShieldCheck :size="13" class="text-sp-blue" /> Experiência WebRTC segura</div>
            <h1 class="text-xl md:text-2xl font-bold mt-1">{{ title }}</h1>
            <p class="text-sm text-sp-muted mt-1">{{ credentials.nameexten || credentials.phone }} · SDK fácil por fora, SIP.js robusto por baixo.</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <div :class="['metric', isRegistered ? 'metric-green' : 'metric-amber']"><Wifi :size="14" /><span>{{ isRegistered ? 'Registrado' : 'Atenção' }}</span><strong>{{ connectionState }}</strong></div>
            <div class="metric metric-blue"><Activity :size="14" /><span>Sessões</span><strong>{{ sessionStates.length }}</strong></div>
            <div class="metric metric-violet"><Terminal :size="14" /><span>Trace SIP</span><strong>{{ sipLogs.length }}</strong></div>
          </div>
        </header>

        <section class="mt-3 h-[calc(100dvh-7.6rem)] min-h-0 overflow-y-auto overflow-x-hidden pr-1 pb-4">
          <div v-if="activeSessionState" class="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)] items-start">
            <section class="sp-card p-5 text-center">
              <div class="mx-auto w-16 h-16 rounded-3xl bg-sp-green flex items-center justify-center shadow-success"><Phone :size="28" class="text-[#04130a]" /></div>
              <p class="mt-5 text-xs uppercase tracking-[.38em] text-sp-muted font-bold">Chamada conectada</p>
              <h2 class="mt-2 text-3xl font-black">{{ callHistory.find(r => r.id === activeSessionState?.callRecordId)?.number || '—' }}</h2>
              <div class="mt-3 font-mono text-4xl text-sp-blue font-black">{{ formatDuration(activeSessionState.session.getCallDuration()) }}</div>

              <div class="mt-5 sp-panel border-sp-green/35 bg-sp-green/10 p-3 text-left">
                <div class="flex items-center justify-between"><strong class="flex items-center gap-2"><Signal :size="16" /> Qualidade</strong><span class="text-xs font-black text-sp-green uppercase">{{ quality?.level || '—' }}</span></div>
                <div class="h-2 bg-white/10 rounded-full mt-3 overflow-hidden"><div class="h-full bg-sp-green rounded-full" :style="{ width: `${quality?.score ?? 0}%` }" /></div>
                <p class="text-xs text-sp-muted mt-2">{{ quality?.recommendation || 'Coletando métricas da chamada…' }}</p>
              </div>

              <div class="mt-5 grid grid-cols-3 gap-2">
                <button class="sp-button-secondary py-3" @click="toggleMute"><component :is="activeSessionState.isMuted ? MicOff : Mic" :size="18" class="mx-auto" /><small>{{ activeSessionState.isMuted ? 'Ativar' : 'Mudo' }}</small></button>
                <button class="sp-button-secondary py-3" @click="toggleHold"><component :is="activeSessionState.isOnHold ? Play : Pause" :size="18" class="mx-auto" /><small>{{ activeSessionState.isOnHold ? 'Retomar' : 'Espera' }}</small></button>
                <button class="sp-button-secondary py-3" @click="showDtmf = !showDtmf"><Hash :size="18" class="mx-auto" /><small>DTMF</small></button>
                <button class="sp-button-secondary py-3" @click="toggleScreenShare"><MonitorIcon :size="18" class="mx-auto" /><small>Tela</small></button>
                <button class="sp-button-secondary py-3" @click="refreshStats"><BarChart2 :size="18" class="mx-auto" /><small>Stats</small></button>
                <button class="sp-button-secondary py-3" @click="activeView='monitor'"><Terminal :size="18" class="mx-auto" /><small>SIP</small></button>
              </div>

              <div v-if="showDtmf" class="mt-4 grid grid-cols-3 gap-2">
                <button v-for="tone in dtmfDigits" :key="tone" class="sp-kbd-button py-3 font-bold" @click="sendDtmf(tone)">{{ tone }}</button>
              </div>

              <div class="mt-4 flex items-center gap-2"><VolumeX :size="14" class="text-sp-muted" /><input v-model.number="volume" class="w-full accent-cyan-400" type="range" min="0" max="1" step="0.05" @input="setVolume" /><Volume2 :size="14" class="text-sp-muted" /></div>

              <button class="mt-5 w-full rounded-2xl bg-sp-red/95 text-white font-black py-4 hover:brightness-110 disabled:opacity-70 transition-all flex items-center justify-center gap-2" :disabled="isHangingUp" @click="hangup"><PhoneOff :size="19" /> {{ isHangingUp ? 'Desligando…' : 'Desligar' }}</button>
            </section>

            <section class="space-y-4 min-w-0">
              <div v-if="sessionStates.length > 1" class="sp-card p-3 flex flex-wrap gap-2">
                <button v-for="ss in sessionStates" :key="ss.session.id" class="px-3 py-2 rounded-2xl text-sm border" :class="ss.session.id === activeSessionId ? 'bg-sp-blue/12 border-sp-blue/45 text-sp-text' : 'bg-white/[.04] border-white/10 text-sp-muted'" @click="switchSession(ss.session.id)">{{ callHistory.find(r => r.id === ss.callRecordId)?.number || '—' }} <span v-if="ss.isOnHold" class="text-sp-amber">em espera</span></button>
              </div>

              <div class="grid lg:grid-cols-2 gap-3">
                <div class="sp-card p-4"><strong>Transferir</strong><div class="flex gap-2 mt-3"><input v-model="transferTarget" class="sp-input" placeholder="Ramal destino" /><button class="sp-button-secondary px-4" @click="transferCall"><ArrowRightLeft :size="17" /></button></div></div>
                <div class="sp-card p-4"><strong>Nova chamada</strong><div class="flex gap-2 mt-3"><input v-model="newCallTarget" class="sp-input" placeholder="Destino" /><button class="sp-button-secondary px-4" @click="makeNewCall"><PhoneCall :size="17" /></button></div></div>
              </div>

              <div class="sp-card p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                <div><span class="text-sp-muted">Jitter</span><strong class="block">{{ quality?.jitterMs ?? 0 }} ms</strong></div>
                <div><span class="text-sp-muted">Perda</span><strong class="block">{{ quality?.packetLossPercent ?? 0 }}%</strong></div>
                <div><span class="text-sp-muted">RTT</span><strong class="block">{{ quality?.rttMs ?? 0 }} ms</strong></div>
                <div><span class="text-sp-muted">Codec</span><strong class="block">{{ quality?.codec || '—' }}</strong></div>
              </div>

              <SipTrace :logs="visibleLogs" />
            </section>
          </div>

          <div v-else class="mx-auto max-w-7xl">
            <div v-if="activeView === 'dialer'" class="grid gap-4 xl:grid-cols-[23rem_minmax(0,1fr)] items-start">
              <section class="sp-card p-5">
                <div class="text-center mb-4">
                  <div class="mx-auto w-14 h-14 rounded-3xl bg-sp-blue/12 border border-sp-blue/20 flex items-center justify-center text-sp-blue shadow-glow"><Phone :size="23" /></div>
                  <h2 class="text-xl font-black mt-3">Digite o ramal ou número</h2>
                  <p class="text-sm text-sp-muted mt-1">Discador limpo para teste rápido de chamada.</p>
                </div>
                <div class="relative mb-3">
                  <input v-model="dialValue" class="w-full bg-white/[0.035] border border-white/10 rounded-3xl text-center text-3xl font-light text-sp-text tracking-[0.18em] py-3.5 focus:border-sp-blue focus:ring-4 focus:ring-sp-blue/10 outline-none placeholder:text-sp-border placeholder:text-2xl transition-all" placeholder="_ _ _" autofocus @keydown.enter="dial" />
                  <button v-if="dialValue" class="absolute right-4 top-1/2 -translate-y-1/2 text-sp-muted hover:text-sp-text" @click="dialValue = dialValue.slice(0, -1)"><Delete :size="19" /></button>
                </div>
                <div class="grid grid-cols-3 gap-2 mb-3">
                  <button v-for="key in digits" :key="key.digit" class="sp-kbd-button flex flex-col items-center justify-center h-16" @click="dialValue += key.digit"><span class="text-sp-text text-2xl font-bold leading-none">{{ key.digit }}</span><span v-if="key.letters" class="text-[9px] text-sp-muted tracking-[.24em] mt-1 font-bold">{{ key.letters }}</span></button>
                </div>
                <button class="w-full sp-button-primary py-3.5 flex items-center justify-center gap-2 text-lg" :disabled="!isRegistered || !dialValue.trim()" @click="dial"><Phone :size="19" /> Ligar agora</button>
                <p v-if="!isRegistered" class="text-xs text-sp-amber mt-3 text-center">Aguardando registro SIP para liberar chamadas.</p>
              </section>

              <section class="space-y-3 min-w-0">
                <MonitorCards :connection-state="connectionState" :credentials="credentials" :health="health" :diagnostics="diagnostics" :sessions-count="sessionStates.length" :history-count="callHistory.length" :logs-count="sipLogs.length" @run-health="runHealth" @run-diagnostics="runDiagnostics" />
                <SipTrace :logs="visibleLogs" />
              </section>
            </div>

            <section v-else-if="activeView === 'history'" class="sp-card p-5 max-w-4xl mx-auto">
              <div class="flex items-center justify-between mb-4"><h2 class="text-lg font-bold">Histórico de chamadas</h2><button v-if="callHistory.length" class="text-sm text-sp-muted hover:text-sp-red flex items-center gap-1" @click="callHistory = []"><Trash2 :size="14" /> Limpar</button></div>
              <p v-if="!callHistory.length" class="text-sp-muted text-sm text-center py-12">Nenhuma chamada ainda.</p>
              <div v-else class="space-y-2">
                <div v-for="record in callHistory" :key="record.id" class="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/[.035] border border-white/10">
                  <div class="flex items-center gap-3"><component :is="record.direction === 'inbound' ? PhoneIncoming : ArrowUpRight" :class="record.status === 'answered' ? 'text-sp-green' : 'text-sp-amber'" :size="18" /><div><strong>{{ record.displayName || record.number }}</strong><div class="text-xs text-sp-muted">{{ formatDate(record.startedAt) }} · {{ formatDuration(record.duration) }}</div></div></div>
                  <button class="sp-button-secondary px-3 py-2" @click="dialValue = record.number; activeView = 'dialer'; dial()"><Phone :size="15" /></button>
                </div>
              </div>
            </section>

            <section v-else-if="activeView === 'messages'" class="grid lg:grid-cols-[22rem_minmax(0,1fr)] gap-4 items-start">
              <div class="sp-card p-5"><h2 class="font-bold mb-4">Enviar mensagem SIP</h2><input v-model="messageTo" class="sp-input mb-3" placeholder="Destino" /><textarea v-model="messageBody" class="sp-input min-h-32" placeholder="Mensagem"></textarea><button class="mt-3 w-full sp-button-primary py-3 flex items-center justify-center gap-2" @click="sendMessage"><Send :size="16" /> Enviar</button></div>
              <div class="sp-card p-5"><div class="flex justify-between"><h2 class="font-bold">Mensagens</h2><button v-if="messages.length" class="text-sp-muted hover:text-sp-red text-sm" @click="messages = []">Limpar</button></div><p v-if="!messages.length" class="text-sp-muted py-12 text-center">Nenhuma mensagem.</p><div v-else class="space-y-2 mt-4"><div v-for="msg in messages" :key="msg.id" class="p-3 rounded-2xl border border-white/10 bg-white/[.035]"><div class="flex justify-between text-xs text-sp-muted"><span>{{ msg.direction === 'inbound' ? 'Recebida de' : 'Enviada para' }} {{ msg.peer }}</span><span>{{ formatDate(msg.timestamp) }}</span></div><p class="mt-2 text-sm">{{ msg.body }}</p></div></div></div>
            </section>

            <section v-else-if="activeView === 'settings'" class="grid lg:grid-cols-2 gap-4 items-start">
              <div class="sp-card p-5"><h2 class="font-bold mb-4">Conta SIP</h2><div v-if="settingsForm" class="space-y-3"><input v-model="settingsForm.phone" class="sp-input" placeholder="Ramal" /><input v-model="settingsForm.secret" class="sp-input" placeholder="Senha" type="password" /><input v-model="settingsForm.domain" class="sp-input" placeholder="Domínio" /><input v-model="settingsForm.server" class="sp-input" placeholder="WebSocket" /><input v-model="settingsForm.authorizationUsername" class="sp-input" placeholder="Auth opcional" /><button class="sp-button-primary py-3 px-4" @click="saveSettings">Salvar e reconectar</button></div></div>
              <div class="sp-card p-5"><div class="flex items-center justify-between"><h2 class="font-bold">Áudio</h2><button class="sp-button-secondary px-3 py-2 text-sm" @click="requestDevices"><RefreshCw :size="14" class="inline" /> Detectar</button></div><div class="grid gap-3 mt-4"><select v-model="devicePrefs.audioInput" class="sp-input"><option value="">Microfone padrão</option><option v-for="d in devices.filter(d => d.kind === 'microphone')" :key="d.id" :value="d.id">{{ d.label }}</option></select><select v-model="devicePrefs.audioOutput" class="sp-input"><option value="">Saída padrão</option><option v-for="d in devices.filter(d => d.kind === 'speaker')" :key="d.id" :value="d.id">{{ d.label }}</option></select><button class="sp-button-secondary py-3" @click="saveDevices">Aplicar dispositivos</button></div></div>
            </section>

            <section v-else class="space-y-4">
              <MonitorCards :connection-state="connectionState" :credentials="credentials" :health="health" :diagnostics="diagnostics" :sessions-count="sessionStates.length" :history-count="callHistory.length" :logs-count="sipLogs.length" @run-health="runHealth" @run-diagnostics="runDiagnostics" />
              <SipTrace :logs="visibleLogs" />
            </section>
          </div>
        </section>
      </main>

      <div v-if="invitation && callerInfo" class="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-center justify-center p-4">
        <section class="sp-card p-6 max-w-sm w-full text-center border-sp-blue/25">
          <div class="mx-auto w-16 h-16 rounded-full bg-sp-green/15 flex items-center justify-center animate-ring"><PhoneIncoming class="text-sp-green" :size="28" /></div>
          <p class="mt-4 text-xs uppercase tracking-[.26em] text-sp-muted font-bold">Chamada recebida</p>
          <h2 class="mt-2 text-2xl font-black">{{ callerInfo.name || callerInfo.number }}</h2>
          <p class="text-sp-muted text-sm">{{ callerInfo.number }}</p>
          <div class="grid grid-cols-2 gap-3 mt-6"><button class="rounded-2xl bg-sp-red text-white py-3 font-bold flex items-center justify-center gap-2" @click="rejectIncoming"><PhoneOff :size="18" /> Recusar</button><button class="sp-button-primary py-3 flex items-center justify-center gap-2" @click="answerIncoming"><PhoneCall :size="18" /> Atender</button></div>
        </section>
      </div>

      <div v-if="callEndReason" class="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
        <div class="flex items-center gap-3 bg-sp-surface/95 border border-sp-red/40 text-sp-text px-5 py-3 rounded-2xl shadow-2xl text-sm font-medium backdrop-blur-xl"><PhoneOff :size="15" class="text-sp-red" />{{ callEndReason }}</div>
      </div>
    </div>
  </div>
</template>
