<script setup lang="ts">
import { Activity, PhoneCall, RefreshCw, ShieldCheck, User, Wifi } from "lucide-vue-next";
import type { SipConnectionState, SipHealthStatus, SoftphoneDiagnostics } from "easy-sipjs";
import type { StoredCredentials } from "../types";

defineProps<{
  connectionState: SipConnectionState;
  credentials: StoredCredentials;
  health?: SipHealthStatus;
  diagnostics?: SoftphoneDiagnostics;
  sessionsCount: number;
  historyCount: number;
  logsCount: number;
}>();

const emit = defineEmits<{
  runHealth: [];
  runDiagnostics: [];
}>();
</script>

<template>
  <div class="grid md:grid-cols-3 gap-3">
    <div class="sp-card p-4 border-sp-green/25 bg-sp-green/10">
      <div class="flex items-center justify-between text-xs uppercase font-bold text-sp-muted">
        <span>Conexão</span>
        <Wifi class="text-sp-green" :size="16" />
      </div>
      <strong class="block text-sp-green text-xl mt-3 capitalize">{{ connectionState }}</strong>
      <p class="text-xs text-sp-muted mt-2 truncate">{{ credentials.server }}</p>
    </div>

    <div class="sp-card p-4">
      <div class="flex items-center justify-between text-xs uppercase font-bold text-sp-muted">
        <span>Conta SIP</span>
        <User class="text-sp-blue" :size="16" />
      </div>
      <div class="mt-3 text-sm grid grid-cols-[5rem_1fr] gap-y-1">
        <span class="text-sp-muted">Ramal</span>
        <strong class="truncate">{{ credentials.phone }}</strong>
        <span class="text-sp-muted">Domínio</span>
        <strong class="truncate">{{ credentials.domain }}</strong>
      </div>
    </div>

    <div class="sp-card p-4">
      <div class="flex items-center justify-between text-xs uppercase font-bold text-sp-muted">
        <span>Operação</span>
        <PhoneCall class="text-sp-violet" :size="16" />
      </div>
      <strong class="block text-sp-violet text-3xl mt-2">{{ sessionsCount }}</strong>
      <p class="text-xs text-sp-muted mt-1">{{ historyCount }} registros · {{ logsCount }} msgs</p>
    </div>

    <div class="sp-card p-4 md:col-span-1">
      <div class="flex items-center justify-between gap-3">
        <strong class="flex items-center gap-2"><Activity class="text-sp-blue" :size="17" /> Health check</strong>
        <button class="sp-button-secondary px-3 py-2 text-xs" @click="emit('runHealth')"><RefreshCw :size="13" class="inline" /> Testar</button>
      </div>
      <p class="text-sm text-sp-muted mt-3">
        {{ health ? (health.registered ? 'Registro ativo' : 'Registro não confirmado') : 'Teste registro, websocket e SIP OPTIONS.' }}
      </p>
    </div>

    <div class="sp-card p-4 md:col-span-2">
      <div class="flex items-center justify-between gap-3">
        <strong class="flex items-center gap-2"><ShieldCheck class="text-sp-green" :size="17" /> Diagnóstico</strong>
        <button class="sp-button-secondary px-3 py-2 text-xs" @click="emit('runDiagnostics')"><RefreshCw :size="13" class="inline" /> Rodar</button>
      </div>
      <p class="text-sm text-sp-muted mt-3">
        {{ diagnostics ? (diagnostics.warnings?.length ? diagnostics.warnings.join(' · ') : 'Ambiente pronto para WebRTC.') : 'Valida permissões, browser e requisitos WebRTC.' }}
      </p>
    </div>
  </div>
</template>
