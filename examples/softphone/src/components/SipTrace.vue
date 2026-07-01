<script setup lang="ts">
import { Terminal } from "lucide-vue-next";
import type { SipLogEntry } from "../types";

defineProps<{ logs: SipLogEntry[] }>();

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
</script>

<template>
  <div class="sp-card overflow-hidden">
    <div class="px-4 py-3 border-b border-white/10 flex items-center justify-between">
      <strong class="flex items-center gap-2 text-sp-green"><Terminal :size="16" /> SIP TRACE</strong>
      <span class="text-xs text-sp-muted">{{ logs.length }} msgs</span>
    </div>
    <div class="max-h-[24rem] overflow-auto text-xs font-mono">
      <div v-if="!logs.length" class="p-8 text-center text-sp-muted">Nenhum pacote SIP ainda.</div>
      <div
        v-for="log in logs"
        :key="log.id"
        class="grid grid-cols-[3rem_5rem_minmax(0,1fr)_5rem] gap-3 px-4 py-2.5 border-b border-white/[.06] hover:bg-white/[.035]"
      >
        <span :class="log.direction === 'sent' ? 'text-sp-blue' : 'text-sp-muted'">{{ log.direction === 'sent' ? '→' : '←' }}</span>
        <strong :class="log.statusCode && log.statusCode >= 400 ? 'text-sp-red' : log.statusCode ? 'text-sp-green' : 'text-sp-blue'">
          {{ log.statusCode || log.method }}
        </strong>
        <span class="truncate text-sp-muted">{{ log.statusText || log.method || 'SIP' }}</span>
        <span class="text-right text-sp-muted">{{ formatTime(log.timestamp) }}</span>
      </div>
    </div>
  </div>
</template>
