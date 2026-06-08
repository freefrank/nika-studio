<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useApiConfigStore, type ApiProfile } from '@/stores/apiConfigStore'

const store = useApiConfigStore()
const editing = ref<ApiProfile | null>(null)
const showForm = ref(false)

const PROVIDER_DEFAULTS: Record<string, { model: string; baseUrl?: string }> = {
  deepseek: { model: 'deepseek-chat' },
  gemini: { model: 'gemini-2.0-flash' },
  'openai-compat': { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
  local: { model: 'llama3', baseUrl: 'http://localhost:11434/v1' },
}

onMounted(() => store.load())

function newProfile() {
  editing.value = {
    id: crypto.randomUUID(), name: '新配置',
    provider: 'deepseek', apiKey: '', model: 'deepseek-chat', updatedAt: 0,
  }
  showForm.value = true
}

function editProfile(p: ApiProfile) {
  editing.value = { ...p }
  showForm.value = true
}

function onProviderChange() {
  if (!editing.value) return
  const d = PROVIDER_DEFAULTS[editing.value.provider]
  editing.value.model = d.model
  editing.value.baseUrl = d.baseUrl
}

async function saveProfile() {
  if (!editing.value) return
  try {
    await store.save(editing.value)
    if (!store.activeId) store.setActive(editing.value.id)
    showForm.value = false
  } catch (e) {
    alert('保存失败: ' + (e as Error).message)
  }
}

async function deleteProfile(id: string) {
  if (!confirm('删除此配置？')) return
  try {
    await store.remove(id)
  } catch (e) {
    alert('删除失败: ' + (e as Error).message)
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Profile list -->
    <div v-for="p in store.profiles" :key="p.id"
      class="flex items-center gap-3.5 px-4.5 py-3.5 rounded-2xl border transition-all duration-300 cursor-pointer shadow-sm relative overflow-hidden group/item"
      :class="store.activeId === p.id
        ? 'border-[var(--primary)] bg-purple-500/5 shadow-[0_0_15px_rgba(168,85,247,0.08)]'
        : 'border-white/5 bg-zinc-950/20 hover:border-white/10 hover:bg-zinc-900/30'"
      @click="store.setActive(p.id)">
      
      <!-- Colored indicator for active profile -->
      <div v-if="store.activeId === p.id" class="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-purple-500 to-pink-500"></div>

      <div class="flex-1 min-w-0">
        <div class="font-extrabold text-sm truncate text-zinc-100 group-hover/item:text-purple-400 transition-colors">{{ p.name }}</div>
        <div class="text-[10px] text-zinc-400 mt-1.5 flex items-center gap-1.5 font-semibold">
          <span class="bg-white/5 border border-white/5 px-2 py-0.5 rounded uppercase tracking-wider text-[9px] text-zinc-300 font-mono">{{ p.provider }}</span>
          <span>·</span>
          <span class="truncate font-mono">{{ p.model }}</span>
        </div>
      </div>
      
      <span v-if="store.activeId === p.id" class="text-[10px] text-[var(--primary)] font-bold shrink-0 bg-purple-500/10 px-2.5 py-1 rounded-md border border-purple-500/10 flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 bg-purple-500 rounded-full animate-ping"></span>
        <span>当前活动</span>
      </span>
      
      <div class="flex items-center gap-1 shrink-0 opacity-40 group-hover/item:opacity-100 transition-opacity">
        <button @click.stop="editProfile(p)" class="text-zinc-400 hover:text-white text-xs p-1.5 hover:bg-white/5 rounded-xl transition-all cursor-pointer" title="编辑配置">✏️</button>
        <button @click.stop="deleteProfile(p.id)" class="text-zinc-400 hover:text-red-400 text-xs p-1.5 hover:bg-white/5 rounded-xl transition-all cursor-pointer" title="删除配置">🗑️</button>
      </div>
    </div>

    <div v-if="!store.profiles.length" class="text-center text-[var(--text-muted)] text-xs py-8 glass-card border-dashed border-white/5 rounded-2xl">
      <span class="text-2xl block mb-2">🔌</span>
      <p class="font-medium">尚无 API 配置，点击下方按钮添加</p>
    </div>

    <button @click="newProfile" class="w-full py-3.5 border border-dashed border-white/10 rounded-2xl text-xs font-bold text-zinc-400 hover:border-[var(--primary)] hover:text-[var(--primary)] hover:bg-purple-500/5 transition-all cursor-pointer shadow-inner">
      + 新增 API 接入配置
    </button>

    <!-- Edit form modal -->
    <div v-if="showForm && editing" class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-md animate-fade-in">
      <div class="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-md flex flex-col gap-4 shadow-2xl animate-slide-up">
        <div class="flex justify-between items-center border-b border-white/5 pb-2">
          <h3 class="font-extrabold text-sm text-white tracking-wide">🔧 配置 API 访问凭证</h3>
          <button @click="showForm = false" class="text-[var(--text-muted)] hover:text-white text-sm">✕</button>
        </div>

        <div class="field">
          <label>配置别名</label>
          <input v-model="editing.name" class="input" placeholder="例如：我的 DeepSeek 接口" />
        </div>

        <div class="field">
          <label>提供商服务</label>
          <select v-model="editing.provider" @change="onProviderChange" class="input cursor-pointer bg-zinc-950">
            <option value="deepseek" class="bg-zinc-950">DeepSeek</option>
            <option value="gemini" class="bg-zinc-950">Google Gemini</option>
            <option value="openai-compat" class="bg-zinc-950">OpenAI 兼容</option>
            <option value="local" class="bg-zinc-950">本地 (Ollama / LocalAI)</option>
          </select>
        </div>

        <div class="field">
          <label>接口密钥 (API Key)</label>
          <input v-model="editing.apiKey" type="password" class="input font-mono" placeholder="sk-..." />
        </div>

        <div class="field">
          <label>默认调用模型 (Model)</label>
          <input v-model="editing.model" class="input font-mono text-xs" placeholder="模型名称" />
        </div>

        <div v-if="editing.provider !== 'deepseek' && editing.provider !== 'gemini'" class="field">
          <label>接口基址 (Base URL)</label>
          <input v-model="editing.baseUrl" class="input font-mono text-xs" placeholder="https://api.domain.com/v1" />
        </div>

        <div class="flex gap-2.5 justify-end mt-4 border-t border-white/5 pt-3">
          <button @click="showForm = false" class="btn-sm px-4.5 py-2 text-xs font-bold rounded-xl">取消</button>
          <button @click="saveProfile" class="btn-primary px-5 py-2.5 text-xs font-extrabold rounded-xl shadow-lg shadow-purple-500/15">保存凭证</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";
.input { @apply w-full bg-zinc-950/45 border border-white/5 text-[var(--text)] px-3.5 py-2.5 rounded-xl outline-none focus:border-[var(--primary)] transition-all focus:bg-zinc-950/80 focus:shadow-[0_0_15px_rgba(168,85,247,0.15)] text-xs md:text-sm; }
.btn-primary { @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white transition-all cursor-pointer; }
.btn-sm { @apply bg-zinc-900 hover:bg-zinc-800 border border-white/5 text-[var(--text)] transition-all cursor-pointer font-bold; }
.field { @apply flex flex-col gap-1.5; }
.field label { @apply text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider select-none; }
</style>

