<script setup lang="ts">
import { ref } from "vue";
import { ChevronDown, ChevronRight, Filter, Terminal, Trash2 } from "lucide-vue-next";
import type { SipLogEntry } from "../types";

const props = withDefaults(defineProps<{
  logs: SipLogEntry[];
  title?: string;
}>(), {
  title: "SIP TRACE",
});

const methodFilter = ref("");
const dirFilter = ref<"all" | "sent" | "received">("all");
const expanded = ref<string | null>(null);
const localCleared = ref<number>(0); // timestamp of last clear

const filtered = computed(() => {
  return props.logs.filter(e => {
    if (e.timestamp < localCleared.value) return false;
    if (dirFilter.value !== "all" && e.direction !== dirFilter.value) return false;
    if (methodFilter.value) {
      const q = methodFilter.value.toUpperCase();
      const label = e.method ?? (e.statusCode ? String(e.statusCode) : "");
      if (!label.includes(q)) return false;
    }
    return true;
  });
});

import { computed } from "vue";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function labelColor(entry: SipLogEntry) {
  if (entry.method) return entry.direction === "sent" ? "text-sp-blue" : "text-cyan-400";
  if (!entry.statusCode) return "text-sp-muted";
  if (entry.statusCode >= 400) return "text-sp-red";
  if (entry.statusCode >= 200) return "text-sp-green";
  return "text-sp-amber";
}
</script>

<template>
  <div class="sp-card flex flex-col overflow-hidden">
    <!-- Toolbar -->
    <div class="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-white/10 bg-[#0a1520]">
      <Terminal :size="13" class="text-sp-green shrink-0" />
      <span class="text-sp-green font-mono text-xs font-bold tracking-wide truncate">{{ title }}</span>
      <span class="text-[10px] text-sp-muted font-mono shrink-0">{{ filtered.length }}/{{ logs.length }}</span>

      <div class="ml-auto flex items-center gap-1.5 shrink-0">
        <!-- Direction filter -->
        <div class="flex items-center bg-white/5 rounded-lg p-0.5">
          <button
            v-for="d in (['all', 'sent', 'received'] as const)" :key="d"
            class="text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors"
            :class="dirFilter === d ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'"
            @click="dirFilter = d"
          >{{ d === 'all' ? 'todos' : d === 'sent' ? '→' : '←' }}</button>
        </div>

        <!-- Method filter -->
        <div class="flex items-center gap-1 bg-white/5 rounded-lg px-2 py-0.5">
          <Filter :size="10" class="text-white/30 shrink-0" />
          <input
            v-model="methodFilter"
            placeholder="INVITE…"
            class="bg-transparent text-[10px] font-mono text-white/70 placeholder:text-white/20 outline-none w-16"
          />
        </div>

        <button class="text-white/30 hover:text-white/60 transition-colors p-1" title="Limpar" @click="localCleared = Date.now()">
          <Trash2 :size="12" />
        </button>
      </div>
    </div>

    <!-- Column headers -->
    <div class="shrink-0 grid grid-cols-[1.5rem_5rem_minmax(0,1fr)_4.5rem] gap-2 px-3 py-1 border-b border-white/5 bg-[#080e17]">
      <span class="font-mono text-[9px] text-white/20"></span>
      <span class="font-mono text-[9px] text-white/20">MÉTODO</span>
      <span class="font-mono text-[9px] text-white/20">DESCRIÇÃO</span>
      <span class="font-mono text-[9px] text-white/20 text-right">HORA</span>
    </div>

    <!-- Rows -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
      <div v-if="filtered.length === 0" class="flex items-center justify-center h-24 text-white/20 font-mono text-xs">
        {{ logs.length === 0 ? 'aguardando mensagens SIP…' : 'nenhuma mensagem no filtro' }}
      </div>

      <template v-for="entry in filtered" :key="entry.id">
        <button
          class="w-full grid grid-cols-[1.5rem_5rem_minmax(0,1fr)_4.5rem] gap-2 px-3 py-1.5 hover:bg-white/[.04] transition-colors text-left border-b border-white/[.04] group"
          @click="expanded = expanded === entry.id ? null : entry.id"
        >
          <span class="font-mono text-xs shrink-0" :class="entry.direction === 'sent' ? 'text-sp-blue' : 'text-sp-muted'">{{ entry.direction === 'sent' ? '→' : '←' }}</span>
          <span class="font-mono text-xs font-bold truncate" :class="labelColor(entry)">{{ entry.statusCode ?? entry.method ?? '?' }}</span>
          <span class="font-mono text-[11px] text-white/40 truncate">{{ entry.statusText || entry.method || 'SIP' }}</span>
          <div class="flex items-center justify-end gap-1 shrink-0">
            <span class="font-mono text-[10px] text-white/25">{{ formatTime(entry.timestamp) }}</span>
            <component :is="expanded === entry.id ? ChevronDown : ChevronRight" :size="10" class="text-white/20 group-hover:text-white/40" />
          </div>
        </button>
        <div v-if="expanded === entry.id" class="px-3 py-3 bg-[#060c14] border-b border-white/[.05]">
          <pre class="font-mono text-[10px] text-green-300/70 whitespace-pre-wrap break-all leading-5 max-h-52 overflow-y-auto">{{ entry.content }}</pre>
        </div>
      </template>
    </div>
  </div>
</template>
