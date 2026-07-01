<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
  AlertTriangle, ArrowRightLeft, BarChart2, Clock, Delete, Hash, History,
  LogOut, MessageSquare, Mic, MicOff, Monitor as MonitorIcon, Pause, Phone,
  PhoneCall, PhoneIncoming, PhoneMissed, PhoneOff, Play, RefreshCw, Send,
  Settings, ShieldCheck, Signal, Sparkles, Terminal, Trash2, User, Volume2,
  VolumeX, Wifi, X,
} from "lucide-vue-next";
import { SipClient } from "easy-sipjs";
import type {
  CallQualitySnapshot, CallStats, ISipSession, SipConnectionState,
  SipHealthStatus, SipInvitation, SoftphoneDiagnostics, SoftphoneDevice,
} from "easy-sipjs";
import { useLocalStorage } from "./composables/useLocalStorage";
import type { CallRecord, DevicePrefs, MessageRecord, SipLogEntry, StoredCredentials } from "./types";
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

// Modal state
const showSettings = ref(false);
const showHistory = ref(false);
const showMessages = ref(false);

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

const activeSessionState = computed(() => sessionStates.value.find(s => s.session.id === activeSessionId.value));
const unreadMessages = computed(() => messages.value.filter(m => !m.read).length);
const isRegistered = computed(() => connectionState.value === "registered");

const statusLabel = computed(() => ({
  registered: "Registrado",
  connected: "Conectado",
  connecting: "Conectando…",
  disconnected: "Desconectado",
  error: "Erro",
}[connectionState.value]));

const visibleLogs = computed(() => sipLogs.value.slice(0, 80));

// Logs desde o início da chamada ativa (para o trace por chamada)
const callLogs = computed(() => {
  const rec = activeSessionState.value
    ? callHistory.value.find(r => r.id === activeSessionState.value!.callRecordId)
    : undefined;
  if (!rec) return visibleLogs.value;
  const since = Date.parse(rec.startedAt);
  return sipLogs.value.filter(e => e.timestamp >= since).slice(0, 120);
});

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
  next.onConnectionStateChange = state => { connectionState.value = state; };
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
  try { remoteAudio.pause(); remoteAudio.srcObject = null; } catch {}
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
  addCallRecord({ id: recordId, direction, number: peer, displayName, startedAt: new Date().toISOString(), duration: 0, status: direction === "outbound" ? "calling" : "answered" });
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
  session.onHold = () => { previousHold?.(); const t = sessionStates.value.find(i => i.session.id === session.id); if (t) t.isOnHold = true; };
  const previousUnhold = session.onUnhold;
  session.onUnhold = () => { previousUnhold?.(); const t = sessionStates.value.find(i => i.session.id === session.id); if (t) t.isOnHold = false; };
  const previousReject = session.onReject;
  session.onReject = (statusCode: number) => {
    previousReject?.(statusCode);
    if (intentionalHangups.has(session.id)) return;
    updateCallRecord(recordId, { status: statusCode === 486 ? "busy" : "failed" });
    showCallEndReason(rejectMessage(statusCode));
  };
  const previousTerminate = session.onTerminate;
  session.onTerminate = () => { previousTerminate?.(); cleanupSessionUi(ss); };
  sessionStates.value = [...sessionStates.value, ss];
  activeSessionId.value = session.id;
}

function showCallEndReason(message: string) {
  callEndReason.value = message;
  window.setTimeout(() => { if (callEndReason.value === message) callEndReason.value = null; }, 4200);
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

async function dial(target?: string) {
  const destination = (target ?? dialValue.value).trim();
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
    await Promise.race([active.session.bye(), new Promise<void>(resolve => window.setTimeout(resolve, 1800))]);
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
  newCallTarget.value = "";
  await dial(target);
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
  showSettings.value = false;
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

function switchSession(id: string) { activeSessionId.value = id; }

watch(credentials, value => { if (value) startClient(); }, { immediate: true });
watch(activeSessionState, () => { stats.value = undefined; quality.value = undefined; });

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
  <!-- ═══ LOGIN ═══════════════════════════════════════════════════════════════ -->
  <div v-if="!credentials" class="min-h-dvh bg-soft-radial text-sp-text p-4 flex items-center justify-center overflow-y-auto">
    <div class="absolute inset-0 pointer-events-none opacity-40 bg-grid" />
    <section class="relative w-full max-w-5xl grid lg:grid-cols-[1fr_28rem] gap-6 items-center">
      <div class="hidden lg:block">
        <div class="inline-flex items-center gap-2 rounded-full border border-sp-blue/25 bg-sp-blue/10 px-4 py-2 text-xs uppercase tracking-[.22em] font-bold text-sp-blue">
          <ShieldCheck :size="14" /> WebRTC SDK
        </div>
        <h1 class="mt-5 text-5xl font-black leading-tight">Softphone pronto para demonstração.</h1>
        <p class="mt-4 text-sp-muted text-lg max-w-xl">Interface em Vue, fluxo simples para testar registro, chamadas, mensagens, trace SIP e diagnóstico.</p>
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
        <p class="text-sm text-sp-muted mt-1 mb-5">Preencha os dados SIP para iniciar.</p>
        <div class="space-y-3">
          <input v-model="loginForm.phone" class="sp-input" placeholder="Ramal" autocomplete="username" />
          <input v-model="loginForm.secret" class="sp-input" placeholder="Senha SIP" type="password" autocomplete="current-password" />
          <input v-model="loginForm.domain" class="sp-input" placeholder="Domínio SIP" />
          <input v-model="loginForm.server" class="sp-input" placeholder="WebSocket WSS" />
          <input v-model="loginForm.authorizationUsername" class="sp-input" placeholder="Usuário de auth (opcional)" />
          <select v-model="loginForm.provider" class="sp-input"><option value="sipjs">SIP.js</option><option value="jssip">JsSIP</option></select>
        </div>
        <p v-if="loginError" class="mt-3 text-sm text-sp-red">{{ loginError }}</p>
        <button class="mt-5 w-full sp-button-primary py-4 flex items-center justify-center gap-2"><PhoneCall :size="18" /> Conectar softphone</button>
      </form>
    </section>
  </div>

  <!-- ═══ COCKPIT ═══════════════════════════════════════════════════════════ -->
  <div v-else class="h-dvh bg-soft-radial text-sp-text overflow-hidden flex flex-col">
    <div class="absolute inset-0 pointer-events-none opacity-45 bg-grid" />

    <!-- ── Top bar ── -->
    <header class="relative shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-white/10 bg-[#07111f]/80 backdrop-blur-2xl overflow-hidden">
      <!-- Identity — shrinks when space is tight -->
      <div class="flex items-center gap-2 min-w-0 shrink">
        <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-sp-blue to-sp-green flex items-center justify-center shadow-glow shrink-0">
          <Phone :size="15" class="text-[#03131d]" />
        </div>
        <div class="leading-none min-w-0">
          <div class="text-sm font-black text-sp-text truncate max-w-[10rem]">{{ credentials.nameexten || credentials.phone }}</div>
          <div class="text-[10px] text-sp-muted truncate">Ramal {{ credentials.phone }}</div>
        </div>
      </div>

      <!-- Status pill — never shrinks -->
      <div :class="['shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border', isRegistered ? 'bg-sp-green/10 border-sp-green/30 text-sp-green' : 'bg-sp-amber/10 border-sp-amber/30 text-sp-amber']">
        <span :class="['w-1.5 h-1.5 rounded-full shrink-0', isRegistered ? 'bg-sp-green' : 'bg-sp-amber animate-pulse']" />
        {{ statusLabel }}
      </div>

      <!-- Metrics strip — hidden on small screens -->
      <div class="hidden lg:flex items-center gap-2 shrink-0">
        <div class="metric metric-blue"><Phone :size="12" /><span>Sessões</span><strong>{{ sessionStates.length }}</strong></div>
        <div class="metric metric-violet"><Terminal :size="12" /><span>SIP</span><strong>{{ sipLogs.length }}</strong></div>
      </div>

      <div class="ml-auto flex items-center gap-1 shrink-0">
        <!-- Messages -->
        <button class="relative p-2 rounded-xl text-sp-muted hover:text-sp-text hover:bg-white/[.06] transition-colors" title="Mensagens SIP" @click="showMessages = true">
          <MessageSquare :size="17" />
          <span v-if="unreadMessages" class="absolute top-1 right-1 w-4 h-4 bg-sp-red text-white text-[9px] font-black rounded-full flex items-center justify-center">{{ unreadMessages }}</span>
        </button>
        <!-- History -->
        <button class="p-2 rounded-xl text-sp-muted hover:text-sp-text hover:bg-white/[.06] transition-colors" title="Histórico" @click="showHistory = true">
          <History :size="17" />
        </button>
        <!-- Settings -->
        <button class="p-2 rounded-xl text-sp-muted hover:text-sp-text hover:bg-white/[.06] transition-colors" title="Ajustes" @click="showSettings = true">
          <Settings :size="17" />
        </button>
        <div class="w-px h-5 bg-white/10 mx-1" />
        <!-- Logout -->
        <button class="p-2 rounded-xl text-sp-muted hover:text-sp-red hover:bg-sp-red/10 transition-colors" title="Desconectar" @click="logout">
          <LogOut :size="17" />
        </button>
      </div>
    </header>

    <!-- ── Cockpit body: left panel + right monitor ── -->
    <div class="relative flex flex-1 min-h-0 gap-0">

      <!-- ── LEFT: Dialer or Active call ── -->
      <div class="w-80 shrink-0 flex flex-col border-r border-white/10 overflow-y-auto overflow-x-hidden p-3 gap-3">

        <!-- Multi-session tabs -->
        <div v-if="sessionStates.length > 1" class="flex flex-wrap gap-1.5">
          <button
            v-for="ss in sessionStates" :key="ss.session.id"
            class="px-2.5 py-1.5 rounded-xl text-xs border transition-all"
            :class="ss.session.id === activeSessionId ? 'bg-sp-blue/12 border-sp-blue/45 text-sp-text' : 'bg-white/[.04] border-white/10 text-sp-muted'"
            @click="switchSession(ss.session.id)"
          >
            {{ callHistory.find(r => r.id === ss.callRecordId)?.number || '—' }}
            <span v-if="ss.isOnHold" class="text-sp-amber ml-1">em espera</span>
          </button>
        </div>

        <!-- ACTIVE CALL panel -->
        <template v-if="activeSessionState">
          <div class="sp-card p-4 text-center">
            <div class="mx-auto w-14 h-14 rounded-3xl bg-sp-green flex items-center justify-center shadow-success">
              <Phone :size="24" class="text-[#04130a]" />
            </div>
            <p class="mt-4 text-[10px] uppercase tracking-[.38em] text-sp-muted font-bold">Em chamada</p>
            <h2 class="mt-1 text-2xl font-black truncate">{{ callHistory.find(r => r.id === activeSessionState?.callRecordId)?.number || '—' }}</h2>
            <div class="mt-2 font-mono text-3xl text-sp-blue font-black">{{ formatDuration(activeSessionState.session.getCallDuration()) }}</div>

            <!-- Quality bar -->
            <div class="mt-4 sp-panel border-sp-green/30 bg-sp-green/8 p-3 text-left">
              <div class="flex items-center justify-between text-xs">
                <span class="flex items-center gap-1 text-sp-muted"><Signal :size="12" /> Qualidade</span>
                <strong class="text-sp-green uppercase">{{ quality?.level || '—' }}</strong>
              </div>
              <div class="h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden">
                <div class="h-full bg-sp-green rounded-full transition-all" :style="{ width: `${quality?.score ?? 0}%` }" />
              </div>
              <p class="text-[11px] text-sp-muted mt-1.5">{{ quality?.recommendation || 'Coletando…' }}</p>
            </div>
          </div>

          <!-- Call controls -->
          <div class="sp-card p-3 grid grid-cols-3 gap-2">
            <button class="sp-button-secondary py-3 flex flex-col items-center gap-1" @click="toggleMute">
              <component :is="activeSessionState.isMuted ? MicOff : Mic" :size="17" />
              <span class="text-[10px]">{{ activeSessionState.isMuted ? 'Ativar' : 'Mudo' }}</span>
            </button>
            <button class="sp-button-secondary py-3 flex flex-col items-center gap-1" @click="toggleHold">
              <component :is="activeSessionState.isOnHold ? Play : Pause" :size="17" />
              <span class="text-[10px]">{{ activeSessionState.isOnHold ? 'Retomar' : 'Espera' }}</span>
            </button>
            <button class="sp-button-secondary py-3 flex flex-col items-center gap-1" :class="showDtmf ? 'bg-sp-blue/15 border-sp-blue/40' : ''" @click="showDtmf = !showDtmf">
              <Hash :size="17" />
              <span class="text-[10px]">DTMF</span>
            </button>
            <button class="sp-button-secondary py-3 flex flex-col items-center gap-1" @click="toggleScreenShare">
              <MonitorIcon :size="17" />
              <span class="text-[10px]">Tela</span>
            </button>
            <button class="sp-button-secondary py-3 flex flex-col items-center gap-1" @click="refreshStats">
              <BarChart2 :size="17" />
              <span class="text-[10px]">Stats</span>
            </button>
            <button class="sp-button-secondary py-3 flex flex-col items-center gap-1 col-span-1">
              <!-- placeholder -->
              <Sparkles :size="17" />
              <span class="text-[10px]">—</span>
            </button>
          </div>

          <!-- DTMF pad -->
          <div v-if="showDtmf" class="sp-card p-3 grid grid-cols-3 gap-1.5">
            <button v-for="tone in dtmfDigits" :key="tone" class="sp-kbd-button py-3 font-bold text-sm" @click="sendDtmf(tone)">{{ tone }}</button>
          </div>

          <!-- Volume -->
          <div class="sp-card px-4 py-3 flex items-center gap-2">
            <VolumeX :size="14" class="text-sp-muted shrink-0" />
            <input v-model.number="volume" class="flex-1 accent-cyan-400" type="range" min="0" max="2" step="0.05" @input="setVolume" />
            <Volume2 :size="14" class="text-sp-muted shrink-0" />
          </div>

          <!-- Transfer / new call -->
          <div class="sp-card p-3 space-y-2">
            <div class="flex gap-2">
              <input v-model="transferTarget" class="sp-input text-sm" placeholder="Transferir para…" @keydown.enter="transferCall" />
              <button class="sp-button-secondary px-3 shrink-0" @click="transferCall"><ArrowRightLeft :size="15" /></button>
            </div>
            <div class="flex gap-2">
              <input v-model="newCallTarget" class="sp-input text-sm" placeholder="Nova chamada…" @keydown.enter="makeNewCall" />
              <button class="sp-button-secondary px-3 shrink-0" @click="makeNewCall"><PhoneCall :size="15" /></button>
            </div>
          </div>

          <!-- Stats row -->
          <div class="sp-card p-3 grid grid-cols-4 gap-2 text-center text-xs">
            <div><span class="text-sp-muted block">Jitter</span><strong>{{ quality?.jitterMs ?? 0 }}ms</strong></div>
            <div><span class="text-sp-muted block">Perda</span><strong>{{ quality?.packetLossPercent ?? 0 }}%</strong></div>
            <div><span class="text-sp-muted block">RTT</span><strong>{{ quality?.rttMs ?? 0 }}ms</strong></div>
            <div><span class="text-sp-muted block">Codec</span><strong class="truncate block">{{ quality?.codec || '—' }}</strong></div>
          </div>

          <!-- Hangup -->
          <button
            class="w-full rounded-2xl bg-sp-red/95 text-white font-black py-4 hover:brightness-110 disabled:opacity-70 transition-all flex items-center justify-center gap-2"
            :disabled="isHangingUp" @click="hangup"
          >
            <PhoneOff :size="18" /> {{ isHangingUp ? 'Desligando…' : 'Desligar' }}
          </button>
        </template>

        <!-- DIALER panel (no active call) -->
        <template v-else>
          <div class="sp-card p-4">
            <div class="text-center mb-4">
              <div class="mx-auto w-12 h-12 rounded-2xl bg-sp-blue/12 border border-sp-blue/20 flex items-center justify-center text-sp-blue shadow-glow">
                <Phone :size="20" />
              </div>
              <h2 class="text-base font-black mt-2">Discador</h2>
            </div>
            <div class="relative mb-3">
              <input
                v-model="dialValue"
                class="w-full bg-white/[0.035] border border-white/10 rounded-3xl text-center text-3xl font-light text-sp-text tracking-[0.18em] py-3 focus:border-sp-blue focus:ring-4 focus:ring-sp-blue/10 outline-none placeholder:text-sp-border placeholder:text-2xl transition-all"
                placeholder="_ _ _"
                autofocus
                @keydown.enter="dial()"
              />
              <button v-if="dialValue" class="absolute right-4 top-1/2 -translate-y-1/2 text-sp-muted hover:text-sp-text" @click="dialValue = dialValue.slice(0, -1)">
                <Delete :size="17" />
              </button>
            </div>
            <div class="grid grid-cols-3 gap-1.5 mb-3">
              <button v-for="key in digits" :key="key.digit" class="sp-kbd-button flex flex-col items-center justify-center h-14" @click="dialValue += key.digit">
                <span class="text-sp-text text-xl font-bold leading-none">{{ key.digit }}</span>
                <span v-if="key.letters" class="text-[8px] text-sp-muted tracking-[.22em] mt-0.5 font-bold">{{ key.letters }}</span>
              </button>
            </div>
            <button
              class="w-full sp-button-primary py-3 flex items-center justify-center gap-2"
              :disabled="!isRegistered || !dialValue.trim()"
              @click="dial()"
            >
              <Phone :size="17" /> Ligar
            </button>
            <p v-if="!isRegistered" class="text-xs text-sp-amber mt-2 text-center">Aguardando registro SIP…</p>
          </div>

          <!-- Recent calls quick-dial -->
          <div v-if="callHistory.length" class="sp-card p-3">
            <p class="text-[10px] uppercase tracking-[.2em] text-sp-muted font-bold mb-2">Recentes</p>
            <div class="space-y-1">
              <button
                v-for="rec in callHistory.slice(0, 4)" :key="rec.id"
                class="w-full flex items-center gap-2 px-2 py-2 rounded-xl hover:bg-white/[.04] transition-colors text-left group"
                @click="dialValue = rec.number; dial()"
              >
                <component :is="rec.direction === 'inbound' ? PhoneIncoming : PhoneMissed" :size="14" :class="rec.status === 'answered' ? 'text-sp-green' : 'text-sp-amber'" class="shrink-0" />
                <span class="flex-1 text-sm font-medium truncate">{{ rec.displayName || rec.number }}</span>
                <span class="text-[10px] text-sp-muted group-hover:text-sp-blue transition-colors shrink-0">ligar</span>
              </button>
            </div>
          </div>
        </template>
      </div>

      <!-- ── RIGHT: Monitor ── -->
      <div class="flex-1 min-w-0 flex flex-col min-h-0 p-3 gap-3 overflow-hidden">

        <!-- Sem chamada: cards de status + trace geral -->
        <template v-if="!activeSessionState">
          <MonitorCards
            :connection-state="connectionState"
            :credentials="credentials"
            :health="health"
            :diagnostics="diagnostics"
            :sessions-count="sessionStates.length"
            :history-count="callHistory.length"
            :logs-count="sipLogs.length"
            @run-health="runHealth"
            @run-diagnostics="runDiagnostics"
          />
          <SipTrace :logs="visibleLogs" class="flex-1 min-h-0" />
        </template>

        <!-- Em chamada: só o trace filtrado desde o início da chamada -->
        <template v-else>
          <SipTrace
            :logs="callLogs"
            :title="`Trace — ${callHistory.find(r => r.id === activeSessionState.callRecordId)?.number ?? '?'}`"
            class="flex-1 min-h-0"
          />
        </template>
      </div>
    </div>

    <!-- ═══ MODAL: Incoming call ════════════════════════════════════════════ -->
    <div v-if="invitation && callerInfo" class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <section class="sp-card p-6 max-w-sm w-full text-center border-sp-blue/25 animate-fade-in">
        <div class="mx-auto w-16 h-16 rounded-full bg-sp-green/15 flex items-center justify-center animate-ring">
          <PhoneIncoming class="text-sp-green" :size="28" />
        </div>
        <p class="mt-4 text-[10px] uppercase tracking-[.26em] text-sp-muted font-bold">Chamada recebida</p>
        <h2 class="mt-2 text-2xl font-black">{{ callerInfo.name || callerInfo.number }}</h2>
        <p class="text-sp-muted text-sm">{{ callerInfo.number }}</p>
        <div class="grid grid-cols-2 gap-3 mt-6">
          <button class="rounded-2xl bg-sp-red text-white py-3 font-bold flex items-center justify-center gap-2" @click="rejectIncoming"><PhoneOff :size="18" /> Recusar</button>
          <button class="sp-button-primary py-3 flex items-center justify-center gap-2" @click="answerIncoming"><PhoneCall :size="18" /> Atender</button>
        </div>
      </section>
    </div>

    <!-- ═══ MODAL: Settings ══════════════════════════════════════════════════ -->
    <div v-if="showSettings" class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm flex items-start justify-end p-4" @click.self="showSettings = false">
      <div class="sp-card w-full max-w-md h-full max-h-[calc(100dvh-2rem)] overflow-y-auto animate-slide-left">
        <div class="sticky top-0 bg-sp-surface border-b border-white/10 px-5 py-4 flex items-center justify-between">
          <h2 class="font-black text-lg flex items-center gap-2"><Settings :size="18" class="text-sp-blue" /> Ajustes</h2>
          <button class="p-1.5 rounded-lg text-sp-muted hover:text-sp-text" @click="showSettings = false"><X :size="17" /></button>
        </div>

        <div class="p-5 space-y-6">
          <!-- SIP account -->
          <div>
            <h3 class="text-xs uppercase tracking-[.2em] font-bold text-sp-muted mb-3">Conta SIP</h3>
            <div v-if="settingsForm" class="space-y-2.5">
              <div><label class="block text-xs text-sp-muted mb-1">Ramal</label><input v-model="settingsForm.phone" class="sp-input" placeholder="Ramal" /></div>
              <div><label class="block text-xs text-sp-muted mb-1">Senha SIP</label><input v-model="settingsForm.secret" class="sp-input" placeholder="Senha" type="password" /></div>
              <div><label class="block text-xs text-sp-muted mb-1">Domínio</label><input v-model="settingsForm.domain" class="sp-input" placeholder="Domínio" /></div>
              <div><label class="block text-xs text-sp-muted mb-1">WebSocket</label><input v-model="settingsForm.server" class="sp-input" placeholder="wss://…" /></div>
              <div><label class="block text-xs text-sp-muted mb-1">Auth user <span class="text-sp-muted/60">(opcional)</span></label><input v-model="settingsForm.authorizationUsername" class="sp-input" placeholder="Igual ao ramal" /></div>
              <div><label class="block text-xs text-sp-muted mb-1">Provider</label><select v-model="settingsForm.provider" class="sp-input"><option value="sipjs">SIP.js</option><option value="jssip">JsSIP</option></select></div>
              <label class="flex items-center gap-2 text-sm cursor-pointer select-none"><input v-model="settingsForm.debug" type="checkbox" class="rounded" /> Debug / SIP trace</label>
            </div>
            <button class="mt-4 sp-button-primary py-3 px-5 flex items-center gap-2" @click="saveSettings"><RefreshCw :size="15" /> Salvar e reconectar</button>
          </div>

          <!-- Audio devices -->
          <div>
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-xs uppercase tracking-[.2em] font-bold text-sp-muted">Áudio</h3>
              <button class="sp-button-secondary px-3 py-1.5 text-xs flex items-center gap-1.5" @click="requestDevices"><RefreshCw :size="12" /> Detectar</button>
            </div>
            <div class="space-y-2.5">
              <div>
                <label class="block text-xs text-sp-muted mb-1">Microfone</label>
                <select v-model="devicePrefs.audioInput" class="sp-input">
                  <option value="">Padrão do sistema</option>
                  <option v-for="d in devices.filter(d => d.kind === 'microphone')" :key="d.id" :value="d.id">{{ d.label }}</option>
                </select>
              </div>
              <div>
                <label class="block text-xs text-sp-muted mb-1">Alto-falante</label>
                <select v-model="devicePrefs.audioOutput" class="sp-input">
                  <option value="">Padrão do sistema</option>
                  <option v-for="d in devices.filter(d => d.kind === 'speaker')" :key="d.id" :value="d.id">{{ d.label }}</option>
                </select>
              </div>
              <button class="sp-button-secondary py-2.5 px-4 w-full" @click="saveDevices">Aplicar dispositivos</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ MODAL: History ════════════════════════════════════════════════════ -->
    <div v-if="showHistory" class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm flex items-start justify-end p-4" @click.self="showHistory = false">
      <div class="sp-card w-full max-w-md h-full max-h-[calc(100dvh-2rem)] overflow-y-auto animate-slide-left">
        <div class="sticky top-0 bg-sp-surface border-b border-white/10 px-5 py-4 flex items-center justify-between">
          <h2 class="font-black text-lg flex items-center gap-2"><History :size="18" class="text-sp-blue" /> Histórico</h2>
          <div class="flex items-center gap-2">
            <button v-if="callHistory.length" class="text-xs text-sp-muted hover:text-sp-red flex items-center gap-1" @click="callHistory = []"><Trash2 :size="13" /> Limpar</button>
            <button class="p-1.5 rounded-lg text-sp-muted hover:text-sp-text" @click="showHistory = false"><X :size="17" /></button>
          </div>
        </div>
        <div class="p-4">
          <p v-if="!callHistory.length" class="text-sp-muted text-sm text-center py-12">Nenhuma chamada ainda.</p>
          <div v-else class="space-y-2">
            <div
              v-for="record in callHistory" :key="record.id"
              class="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/[.035] border border-white/10"
            >
              <div class="flex items-center gap-3 min-w-0">
                <component :is="record.direction === 'inbound' ? PhoneIncoming : PhoneMissed" :class="record.status === 'answered' ? 'text-sp-green' : 'text-sp-amber'" :size="16" class="shrink-0" />
                <div class="min-w-0">
                  <strong class="block truncate">{{ record.displayName || record.number }}</strong>
                  <div class="text-xs text-sp-muted">{{ formatDate(record.startedAt) }} · {{ formatDuration(record.duration) }}</div>
                </div>
              </div>
              <button class="sp-button-secondary px-3 py-2 shrink-0" @click="dialValue = record.number; showHistory = false; dial()"><Phone :size="14" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ MODAL: Messages ══════════════════════════════════════════════════ -->
    <div v-if="showMessages" class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm flex items-start justify-end p-4" @click.self="showMessages = false">
      <div class="sp-card w-full max-w-md h-full max-h-[calc(100dvh-2rem)] overflow-y-auto animate-slide-left flex flex-col">
        <div class="sticky top-0 bg-sp-surface border-b border-white/10 px-5 py-4 flex items-center justify-between shrink-0">
          <h2 class="font-black text-lg flex items-center gap-2"><MessageSquare :size="18" class="text-sp-blue" /> Mensagens SIP <span v-if="unreadMessages" class="bg-sp-red text-white text-[10px] rounded-full px-1.5 py-0.5">{{ unreadMessages }}</span></h2>
          <div class="flex items-center gap-2">
            <button v-if="messages.length" class="text-xs text-sp-muted hover:text-sp-red flex items-center gap-1" @click="messages = []"><Trash2 :size="13" /> Limpar</button>
            <button class="p-1.5 rounded-lg text-sp-muted hover:text-sp-text" @click="showMessages = false"><X :size="17" /></button>
          </div>
        </div>
        <div class="p-4 space-y-3 shrink-0">
          <input v-model="messageTo" class="sp-input" placeholder="Destino" />
          <textarea v-model="messageBody" class="sp-input min-h-20" placeholder="Mensagem…"></textarea>
          <button class="w-full sp-button-primary py-2.5 flex items-center justify-center gap-2" @click="sendMessage"><Send :size="15" /> Enviar</button>
        </div>
        <div class="flex-1 p-4 pt-0 space-y-2 overflow-y-auto">
          <p v-if="!messages.length" class="text-sp-muted text-sm text-center py-8">Nenhuma mensagem ainda.</p>
          <div v-for="msg in messages" :key="msg.id" class="p-3 rounded-2xl border border-white/10 bg-white/[.035]">
            <div class="flex justify-between text-[11px] text-sp-muted mb-1">
              <span>{{ msg.direction === 'inbound' ? '← ' + msg.peer : '→ ' + msg.peer }}</span>
              <span>{{ formatDate(msg.timestamp) }}</span>
            </div>
            <p class="text-sm">{{ msg.body }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ Toast: call ended ════════════════════════════════════════════════ -->
    <div v-if="callEndReason" class="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
      <div class="flex items-center gap-3 bg-sp-surface/95 border border-sp-red/40 text-sp-text px-5 py-3 rounded-2xl shadow-2xl text-sm font-medium backdrop-blur-xl">
        <PhoneOff :size="15" class="text-sp-red" />{{ callEndReason }}
      </div>
    </div>
  </div>
</template>
