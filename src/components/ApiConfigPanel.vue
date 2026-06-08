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
      class="flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer shadow-sm"
      :class="store.activeId === p.id
        ? 'border-[var(--primary)] bg-purple-500/10'
        : 'border-white/5 bg-zinc-900/50 hover:border-white/10 hover:bg-zinc-900'"
      @click="store.setActive(p.id)">
      <div class="flex-1 min-w-0">
        <div class="font-bold text-sm truncate">{{ p.name }}</div>
        <div class="text-xs text-[var(--text-muted)] mt-0.5">{{ p.provider }} · {{ p.model }}</div>
      </div>
      <span v-if="store.activeId === p.id" class="text-xs text-[var(--primary)] font-bold mr-2">使用中</span>
      <button @click.stop="editProfile(p)" class="text-[var(--text-muted)] hover:text-white text-sm p-1 hover:bg-white/5 rounded transition-colors cursor-pointer">✏️</button>
      <button @click.stop="deleteProfile(p.id)" class="text-[var(--text-muted)] hover:text-red-400 text-sm p-1 hover:bg-white/5 rounded transition-colors cursor-pointer">🗑️</button>
    </div>

    <div v-if="!store.profiles.length" class="text-center text-[var(--text-muted)] text-sm py-4">
      尚无配置，点击下方添加
    </div>

    <button @click="newProfile" class="w-full py-2.5 border border-dashed border-white/10 rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-all cursor-pointer hover:bg-purple-500/5">
      + 添加配置
    </button>

    <!-- Edit form modal -->
    <div v-if="showForm && editing" class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-[2px]">
      <div class="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-md flex flex-col gap-4 shadow-2xl shadow-purple-500/5 animate-slide-up">
        <h3 class="font-bold text-base text-white">编辑API配置</h3>

        <div class="field"><label>配置名称</label>
          <input v-model="editing.name" class="input" placeholder="例如：我的DeepSeek" /></div>

        <div class="field"><label>服务商</label>
          <select v-model="editing.provider" @change="onProviderChange" class="input cursor-pointer">
            <option value="deepseek" class="bg-zinc-950">DeepSeek</option>
            <option value="gemini" class="bg-zinc-950">Google Gemini</option>
            <option value="openai-compat" class="bg-zinc-950">OpenAI 兼容</option>
            <option value="local" class="bg-zinc-950">本地 (Ollama等)</option>
          </select>
        </div>

        <div class="field"><label>API Key</label>
          <input v-model="editing.apiKey" type="password" class="input" placeholder="sk-..." /></div>

        <div class="field"><label>模型</label>
          <input v-model="editing.model" class="input" placeholder="模型名称" /></div>

        <div v-if="editing.provider !== 'deepseek' && editing.provider !== 'gemini'" class="field">
          <label>Base URL</label>
          <input v-model="editing.baseUrl" class="input" placeholder="https://..." />
        </div>

        <div class="flex gap-2.5 justify-end mt-2">
          <button @click="showForm = false" class="btn-sm px-4 py-2 text-xs font-semibold rounded-xl">取消</button>
          <button @click="saveProfile" class="btn-primary px-5 py-2.5 text-xs font-bold rounded-xl shadow-md shadow-purple-500/10 hover:shadow-purple-500/20 active:scale-95">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";
.input { @apply w-full bg-zinc-950/50 border border-white/5 text-[var(--text)] px-3.5 py-2.5 rounded-xl outline-none focus:border-[var(--primary)] transition-all focus:bg-zinc-950/80 focus:shadow-[0_0_15px_rgba(168,85,247,0.15)] text-sm; }
.btn-primary { @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white transition-all cursor-pointer; }
.btn-sm { @apply bg-zinc-900 hover:bg-zinc-800 border border-white/5 text-[var(--text)] transition-all cursor-pointer; }
.field { @apply flex flex-col gap-1.5; }
.field label { @apply text-xs text-[var(--text-muted)] font-semibold uppercase tracking-wider; }
</style>
