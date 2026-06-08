<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCharacterStore } from '@/stores/characterStore'
import { chatService } from '@/services/chatService'
import { settingsService } from '@/services/settingsService'
import { streamChat } from '@/services/apiService'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { applyRegexScripts } from '@/services/regexService'
import type { ChatSession, ChatMessage } from '@/types'

const route = useRoute()
const router = useRouter()
const charStore = useCharacterStore()

const characterId = route.params.id as string
const session = ref<ChatSession | null>(null)
const input = ref('')
const streaming = ref(false)
const abortCtrl = ref<AbortController | null>(null)
const messagesEl = ref<HTMLElement | null>(null)
const editingId = ref<string | null>(null)
const editContent = ref('')
const showSettings = ref(false)
const settings = ref(settingsService.get())
const inputEl = ref<HTMLTextAreaElement | null>(null)

type ApiMessage = { role: 'user' | 'assistant' | 'system'; content: string }

function adjustHeight() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

watch(input, (newVal) => {
  if (!newVal) {
    nextTick(() => {
      if (inputEl.value) inputEl.value.style.height = 'auto'
    })
  }
})

marked.setOptions({ breaks: true })

const char = computed(() => charStore.characters.find(c => c.id === characterId))

onMounted(async () => {
  if (!charStore.characters.length) await charStore.load()
  if (!char.value) { router.push('/'); return }
  let s = await chatService.getByCharacter(characterId)
  if (!s) {
    s = { id: crypto.randomUUID(), characterId, messages: [], createdAt: Date.now(), updatedAt: Date.now() }
    const firstMes = char.value.cardData.data.first_mes
    if (firstMes) s.messages.push({ id: crypto.randomUUID(), role: 'assistant', content: firstMes, timestamp: Date.now() })
    try {
      await chatService.save(s)
    } catch (e) {
      console.error('Failed to save initial chat session', e)
    }
  }
  session.value = s
  await scrollBottom()
})

async function scrollBottom() {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}
watch(() => session.value?.messages.length, scrollBottom)

function renderMarkdown(text: string): string {
  const regexScripts = char.value?.cardData.data.regex_scripts
  const processedText = applyRegexScripts(text, regexScripts)
  const rawHtml = marked.parse(processedText) as string
  return DOMPurify.sanitize(rawHtml)
}

async function completeAssistantResponse(content: string, appendUserMessage: boolean) {
  if (!content || streaming.value || !session.value) return
  if (appendUserMessage) {
    session.value.messages.push({ id: crypto.randomUUID(), role: 'user', content, timestamp: Date.now() })
  }
  const aMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', timestamp: Date.now() }
  session.value.messages.push(aMsg)
  streaming.value = true
  abortCtrl.value = new AbortController()
  await scrollBottom()
  try {
    const cfg = settings.value.apiConfig
    const d = char.value!.cardData.data
    const systemPrompt = d.system_prompt || d.description || ''
    const history: ApiMessage[] = session.value.messages.slice(0, -1).slice(-20)
      .map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }))
    const messages: ApiMessage[] = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      ...history,
    ]
    const lastHistoryMessage = history[history.length - 1]
    if (!lastHistoryMessage || lastHistoryMessage.role !== 'user' || lastHistoryMessage.content !== content) {
      messages.push({ role: 'user', content })
    }
    if (!cfg.apiKey && cfg.provider !== 'local') {
      const mock = '请先在设置中配置API Key。'
      for (const ch of mock) { aMsg.content += ch; await new Promise(r => setTimeout(r, 30)) }
    } else {
      await streamChat(cfg, messages, delta => { aMsg.content += delta }, abortCtrl.value.signal)
    }
  } catch (e: unknown) {
    if ((e as Error)?.name !== 'AbortError') aMsg.content += '\n[错误: ' + (e as Error).message + ']'
  } finally {
    streaming.value = false
    try {
      await chatService.save(session.value!)
    } catch (e) {
      aMsg.content += '\n[保存失败: ' + (e as Error).message + ']'
    }
  }
}

async function send() {
  if (!input.value.trim() || streaming.value || !session.value) return
  const content = input.value.trim()
  input.value = ''
  await completeAssistantResponse(content, true)
}

function stopStream() { abortCtrl.value?.abort() }

function startEdit(msg: ChatMessage) { editingId.value = msg.id; editContent.value = msg.content }
async function confirmEdit(msg: ChatMessage) {
  msg.content = editContent.value; editingId.value = null
  if (!session.value) return
  try {
    await chatService.save(session.value)
  } catch (e) {
    alert('保存失败: ' + (e as Error).message)
  }
}
async function deleteMessage(id: string) {
  if (!session.value) return
  session.value.messages = session.value.messages.filter(m => m.id !== id)
  try {
    await chatService.save(session.value)
  } catch (e) {
    alert('删除失败: ' + (e as Error).message)
  }
}
async function regenerate(idx: number) {
  if (!session.value || streaming.value) return
  const messages = session.value.messages
  if (messages[idx]?.role !== 'assistant') return

  let userIdx = -1
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userIdx = i
      break
    }
  }
  if (userIdx === -1) return

  const content = messages[userIdx].content.trim()
  if (!content) return
  session.value.messages = messages.slice(0, userIdx + 1)
  input.value = ''
  await completeAssistantResponse(content, false)
}
async function clearChat() {
  if (!session.value || !confirm('清空所有对话记录？')) return
  session.value.messages = []
  const firstMes = char.value?.cardData.data.first_mes
  if (firstMes) session.value.messages.push({ id: crypto.randomUUID(), role: 'assistant', content: firstMes, timestamp: Date.now() })
  try {
    await chatService.save(session.value)
  } catch (e) {
    alert('清空失败: ' + (e as Error).message)
  }
}
function onKeydown(e: KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }
function saveSettings() { settingsService.save(settings.value); showSettings.value = false }
</script>

<template>
  <div class="h-screen flex flex-col bg-[var(--bg)] text-[var(--text)] animate-slide-up">
    <!-- Header -->
    <div class="flex items-center gap-3 px-4 py-3 bg-[var(--bg-2)]/80 backdrop-blur-md border-b border-white/5 shrink-0 z-20">
      <button @click="router.push('/')" class="text-xl hover:text-[var(--primary)] transition-colors cursor-pointer">←</button>
      <img v-if="char?.avatar" :src="char.avatar" class="w-8 h-8 rounded-full object-cover border border-white/10" />
      <span v-else class="text-2xl">🎭</span>
      <span class="font-bold text-sm flex-1 tracking-wide">{{ char?.name ?? '...' }}</span>
      <button @click="router.push(`/agent/${characterId}`)" class="w-8 h-8 rounded-lg flex items-center justify-center text-sm text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--primary)] transition-all cursor-pointer" title="AI助手">🤖</button>
      <button @click="clearChat" class="w-8 h-8 rounded-lg flex items-center justify-center text-sm text-[var(--text-muted)] hover:bg-white/5 hover:text-red-400 transition-all cursor-pointer" title="清空对话">🗑️</button>
      <button @click="showSettings = !showSettings" class="w-8 h-8 rounded-lg flex items-center justify-center text-sm text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--primary)] transition-all cursor-pointer" :class="{ 'text-[var(--primary)] bg-white/5': showSettings }">⚙️</button>
    </div>

    <!-- Settings panel -->
    <div v-if="showSettings" class="glass-panel mx-4 mt-3 rounded-xl p-4 flex flex-col gap-3 shrink-0 z-10 animate-slide-up shadow-xl shadow-black/20">
      <div class="flex gap-3 flex-wrap">
        <select v-model="settings.apiConfig.provider" class="input w-36 cursor-pointer">
          <option value="deepseek" class="bg-zinc-950">DeepSeek</option>
          <option value="gemini" class="bg-zinc-950">Gemini</option>
          <option value="openai-compat" class="bg-zinc-950">OpenAI兼容</option>
          <option value="local" class="bg-zinc-950">本地</option>
        </select>
        <input v-model="settings.apiConfig.apiKey" class="input flex-1 min-w-40" placeholder="API Key" type="password" />
        <input v-model="settings.apiConfig.model" class="input w-44" placeholder="模型名" />
        <input v-if="settings.apiConfig.provider !== 'deepseek' && settings.apiConfig.provider !== 'gemini'"
          v-model="settings.apiConfig.baseUrl" class="input flex-1 min-w-40" placeholder="Base URL" />
      </div>
      <div class="flex justify-end gap-2">
        <button @click="router.push('/settings')" class="btn-sm text-sm py-1.5 px-3 rounded-lg">更多设置</button>
        <button @click="saveSettings" class="btn-primary-sm py-1.5 px-4 rounded-lg font-bold">保存</button>
      </div>
    </div>

    <!-- Messages -->
    <div ref="messagesEl" class="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">
      <div v-if="!session" class="text-center text-[var(--text-muted)] mt-20">加载中...</div>
      <template v-for="(msg, idx) in session?.messages ?? []" :key="msg.id">
        <div :class="['flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start']" class="animate-slide-up">
          <div v-if="msg.role === 'assistant'" class="shrink-0 mt-1">
            <img v-if="char?.avatar" :src="char.avatar" class="w-8 h-8 rounded-full object-cover border border-white/5 shadow-sm" />
            <span v-else class="text-2xl">🎭</span>
          </div>
          <div class="max-w-[80%] md:max-w-[70%] group relative">
            <div v-if="editingId === msg.id" class="flex flex-col gap-2">
              <textarea v-model="editContent" class="input resize-y min-h-[80px] w-[280px] md:w-[400px]" />
              <div class="flex gap-2 justify-end">
                <button @click="editingId = null" class="btn-sm">取消</button>
                <button @click="confirmEdit(msg)" class="btn-primary-sm">确认</button>
              </div>
            </div>
            <div v-else :class="['bubble relative', msg.role === 'user' ? 'bubble-user' : 'bubble-ai']">
              <span v-if="streaming && idx === (session?.messages.length ?? 0) - 1 && !msg.content" class="animate-pulse text-[var(--text-muted)]">▋</span>
              <!-- User: plain text; Assistant: markdown -->
              <span v-else-if="msg.role === 'user'" style="white-space: pre-wrap">{{ msg.content }}</span>
              <div v-else class="prose-ai" v-html="renderMarkdown(msg.content)" />
            </div>
            <!-- Bubble controls (Floating above on hover) -->
            <div v-if="editingId !== msg.id" class="absolute -top-3.5 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0 z-10">
              <button @click="startEdit(msg)" class="action-btn" title="编辑">✏️</button>
              <button @click="deleteMessage(msg.id)" class="action-btn" title="删除">🗑️</button>
              <button v-if="msg.role === 'assistant'" @click="regenerate(idx)" class="action-btn" title="重新生成">🔄</button>
            </div>
          </div>
        </div>
      </template>
      <div v-if="streaming" class="flex justify-start pl-11">
        <button @click="stopStream" class="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-2.5 py-1 rounded-lg transition-colors cursor-pointer">■ 停止生成</button>
      </div>
    </div>

    <!-- Input -->
    <div class="px-4 py-4 bg-[var(--bg-2)]/60 backdrop-blur-md border-t border-white/5 shrink-0 flex gap-3 items-end">
      <div class="flex-1 relative glass-panel rounded-xl overflow-hidden border border-white/5 focus-within:border-[var(--primary)] transition-all shadow-inner">
        <textarea 
          v-model="input" 
          @keydown="onKeydown" 
          :disabled="streaming" 
          rows="1"
          @input="adjustHeight"
          ref="inputEl"
          class="w-full bg-transparent text-[var(--text)] px-3.5 py-3 outline-none resize-none max-h-40 min-h-[44px] text-sm leading-relaxed" 
          placeholder="输入消息... (Enter 发送，Shift+Enter 换行)" 
        />
      </div>
      <button 
        @click="send" 
        :disabled="streaming || !input.trim()" 
        class="btn-send flex items-center justify-center rounded-xl w-11 h-11 shrink-0 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
          <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";
.input { @apply w-full bg-zinc-900/50 border border-white/5 text-[var(--text)] px-3 py-2 rounded-lg outline-none focus:border-[var(--primary)] transition-colors text-sm focus:bg-zinc-900/85; }
.btn-primary { @apply bg-[var(--primary)] hover:bg-[var(--primary-dark)] text-white px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-40 cursor-pointer; }
.btn-primary-sm { @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer; }
.btn-sm { @apply bg-zinc-800/80 border border-white/5 text-[var(--text)] px-3 py-1.5 rounded-lg text-xs transition-colors hover:bg-zinc-700/80 cursor-pointer; }
.btn-send { @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg shadow-purple-500/10 hover:shadow-purple-500/20; }
.bubble { @apply px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm; }
.bubble-user { @apply bg-gradient-to-br from-purple-600 to-indigo-600 border border-purple-500/20 text-white rounded-tr-sm; }
.bubble-ai { 
  @apply bg-zinc-900/50 border border-white/5 text-zinc-100 rounded-tl-sm relative overflow-hidden pl-5;
}
.bubble-ai::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  background: linear-gradient(to bottom, var(--primary), #ec4899);
  border-radius: 0 4px 4px 0;
}
.action-btn { @apply text-xs bg-zinc-900/80 hover:bg-zinc-800 border border-white/10 hover:border-purple-500/50 rounded-lg p-1.5 text-white shadow-lg backdrop-blur-md cursor-pointer transition-all duration-150; }

/* Markdown prose styles */
:deep(.prose-ai) { @apply text-sm leading-relaxed; }
:deep(.prose-ai p) { @apply mb-2 last:mb-0; }
:deep(.prose-ai strong) { @apply font-bold text-white; }
:deep(.prose-ai em) { @apply italic text-zinc-300; }
:deep(.prose-ai ul) { @apply list-disc pl-5 mb-2.5; }
:deep(.prose-ai ol) { @apply list-decimal pl-5 mb-2.5; }
:deep(.prose-ai li) { @apply mb-1; }
:deep(.prose-ai code) { @apply bg-black/40 rounded px-1.5 py-0.5 text-xs font-mono text-pink-400 border border-white/5; }
:deep(.prose-ai pre) { @apply bg-zinc-950/80 border border-white/5 rounded-xl p-3.5 overflow-x-auto text-xs font-mono mb-2.5 whitespace-pre shadow-inner text-zinc-300; }
:deep(.prose-ai h1, .prose-ai h2, .prose-ai h3) { @apply font-bold mb-2 mt-4 text-white; }
:deep(.prose-ai h1) { @apply text-base; }
:deep(.prose-ai h2) { @apply text-sm; }
:deep(.prose-ai h3) { @apply text-xs; }
:deep(.prose-ai blockquote) { @apply border-l-2 border-[var(--primary)] pl-3 italic text-[var(--text-muted)] mb-2.5; }
:deep(.prose-ai a) { @apply text-[var(--primary)] hover:underline; }
:deep(.prose-ai hr) { @apply border-white/5 my-3; }
</style>
