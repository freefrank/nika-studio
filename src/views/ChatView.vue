<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch, inject, type Ref } from 'vue'
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
const globalShowSettings = inject<Ref<boolean>>('showSettings')

function openGlobalSettings() {
  if (globalShowSettings) {
    globalShowSettings.value = true
  }
}

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
  <div class="h-screen flex flex-col bg-[var(--bg)] text-[var(--text)] animate-slide-up overflow-hidden">
    <!-- Header -->
    <header class="flex items-center gap-3 px-5 py-3.5 bg-[var(--bg-2)]/85 backdrop-blur-md border-b border-white/5 shrink-0 z-20 shadow-md">
      <button @click="router.push('/')" class="btn-back-arrow">←</button>
      
      <div class="relative shrink-0">
        <img v-if="char?.avatar" :src="char.avatar" class="w-9 h-9 rounded-full object-cover border border-white/10 shadow-md" />
        <span v-else class="text-3xl">🎭</span>
        <!-- Online Status Dot Indicator -->
        <span class="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-zinc-950 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
      </div>

      <div class="flex-1 min-w-0">
        <div class="font-extrabold text-sm md:text-base text-zinc-100 truncate tracking-wide">{{ char?.name ?? '...' }}</div>
        <div class="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
          <span>●</span> 正在交谈
        </div>
      </div>

      <!-- Action buttons -->
      <div class="flex items-center gap-1.5">
        <button @click="router.push(`/agent/${characterId}`)" class="btn-header-action" title="AI助手">🤖</button>
        <button @click="clearChat" class="btn-header-action hover:text-red-400" title="清空对话">🗑️</button>
        <button @click="showSettings = !showSettings" class="btn-header-action" :class="{ 'text-[var(--primary)] bg-white/5': showSettings }">⚙️</button>
      </div>
    </header>

    <!-- Settings panel -->
    <div v-if="showSettings" class="glass-card mx-4 mt-3 rounded-2xl p-5 flex flex-col gap-4 shrink-0 z-10 animate-slide-up shadow-xl">
      <h3 class="text-xs font-bold text-purple-400 uppercase tracking-wider">对话 API 临时配置</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-[10px] text-zinc-500 font-bold uppercase">服务商</label>
          <select v-model="settings.apiConfig.provider" class="input w-full cursor-pointer bg-zinc-950">
            <option value="deepseek" class="bg-zinc-950">DeepSeek</option>
            <option value="gemini" class="bg-zinc-950">Gemini</option>
            <option value="openai-compat" class="bg-zinc-950">OpenAI兼容</option>
            <option value="local" class="bg-zinc-950">本地 (Ollama)</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[10px] text-zinc-500 font-bold uppercase">API Key</label>
          <input v-model="settings.apiConfig.apiKey" class="input w-full" placeholder="API Key" type="password" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[10px] text-zinc-500 font-bold uppercase">当前模型</label>
          <input v-model="settings.apiConfig.model" class="input w-full" placeholder="模型名" />
        </div>
      </div>
      <div v-if="settings.apiConfig.provider !== 'deepseek' && settings.apiConfig.provider !== 'gemini'" class="flex flex-col gap-1">
        <label class="text-[10px] text-zinc-500 font-bold uppercase">接口基址 (Base URL)</label>
        <input v-model="settings.apiConfig.baseUrl" class="input" placeholder="Base URL" />
      </div>
      <!-- Local proxy switch -->
      <div class="flex items-center gap-2 mt-1 select-none">
        <input type="checkbox" id="chat-use-local-proxy" v-model="settings.apiConfig.useProxy" class="accent-purple-500 w-4 h-4 rounded cursor-pointer" />
        <label for="chat-use-local-proxy" class="text-xs text-zinc-300 font-semibold cursor-pointer">使用本地开发代理 (解决 CORS 跨源限制)</label>
      </div>
      <div class="flex justify-end gap-2 border-t border-white/5 pt-3">
        <button @click="openGlobalSettings" class="btn-sm text-xs py-1.5 px-3.5 font-semibold">更多高级设置</button>
        <button @click="saveSettings" class="btn-primary-sm py-1.5 px-4 font-bold text-xs rounded-xl shadow-md shadow-purple-500/15">确认保存</button>
      </div>
    </div>

    <!-- Messages List -->
    <div ref="messagesEl" class="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-6 scroll-smooth">
      <div v-if="!session" class="text-center text-[var(--text-muted)] mt-20 flex flex-col items-center justify-center gap-2">
        <div class="inline-block w-8 h-8 border-2 border-t-purple-500 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"></div>
        <span class="text-xs font-semibold">聊天会话加载中...</span>
      </div>

      <template v-for="(msg, idx) in session?.messages ?? []" :key="msg.id">
        <div :class="['flex gap-3.5 items-start', msg.role === 'user' ? 'justify-end' : 'justify-start']" class="animate-fade-in group">
          <!-- Character Avatar -->
          <div v-if="msg.role === 'assistant'" class="shrink-0 mt-0.5">
            <img v-if="char?.avatar" :src="char.avatar" class="w-8.5 h-8.5 rounded-full object-cover border border-white/5 shadow-md" />
            <span v-else class="text-2xl">🎭</span>
          </div>

          <!-- Message Bubble Container -->
          <div class="max-w-[85%] md:max-w-[70%] relative">
            <!-- Bubble Editing state -->
            <div v-if="editingId === msg.id" class="glass-card p-4 rounded-2xl flex flex-col gap-2.5 min-w-[260px] md:min-w-[400px] border-purple-500/30">
              <span class="text-[10px] text-purple-400 font-bold uppercase tracking-wider">编辑消息内容</span>
              <textarea v-model="editContent" class="input resize-y min-h-[100px]" />
              <div class="flex gap-2 justify-end">
                <button @click="editingId = null" class="btn-sm text-[10px] py-1 px-3">取消</button>
                <button @click="confirmEdit(msg)" class="btn-primary-sm text-[10px] py-1.5 px-3 font-bold rounded-lg">完成修改</button>
              </div>
            </div>

            <!-- Bubble View state -->
            <div v-else :class="['bubble relative', msg.role === 'user' ? 'bubble-user' : 'bubble-ai']">
              <span v-if="streaming && idx === (session?.messages.length ?? 0) - 1 && !msg.content" class="animate-pulse text-[var(--primary)] font-bold">▋</span>
              
              <!-- User text: preserves spacing -->
              <span v-else-if="msg.role === 'user'" class="whitespace-pre-wrap select-text text-sm leading-relaxed">{{ msg.content }}</span>
              
              <!-- AI markdown content -->
              <div v-else class="prose-ai select-text" v-html="renderMarkdown(msg.content)" />
            </div>

            <!-- Bubble Floating actions (Show on hover) -->
            <div v-if="editingId !== msg.id" 
              class="absolute -top-3.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-1 group-hover:translate-y-0 z-10"
              :class="msg.role === 'user' ? 'left-2' : 'right-2'">
              <button @click="startEdit(msg)" class="action-btn" title="修改内容">✏️</button>
              <button @click="deleteMessage(msg.id)" class="action-btn hover:text-red-400 hover:border-red-500/30" title="删除消息">🗑️</button>
              <button v-if="msg.role === 'assistant'" @click="regenerate(idx)" class="action-btn hover:text-purple-400 hover:border-purple-500/30" title="重新生成">🔄</button>
            </div>
          </div>
        </div>
      </template>

      <!-- Stop stream button -->
      <div v-if="streaming" class="flex justify-start pl-12 shrink-0">
        <button @click="stopStream" class="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3.5 py-1.5 rounded-xl transition-all cursor-pointer font-bold shadow shadow-red-500/5 hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-1.5">
          <span class="inline-block w-2 h-2 bg-red-500 rounded-full animate-ping"></span>
          <span>停止生成</span>
        </button>
      </div>
    </div>

    <!-- Bottom Input Area -->
    <div class="px-4 py-4 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/95 to-transparent shrink-0">
      <div class="max-w-4xl mx-auto flex gap-3 items-end">
        <div class="flex-1 relative glass-card rounded-2xl border border-white/5 focus-within:border-[var(--primary)] focus-within:shadow-[0_0_20px_rgba(168,85,247,0.15)] transition-all overflow-hidden flex items-end">
          <textarea 
            v-model="input" 
            @keydown="onKeydown" 
            :disabled="streaming" 
            rows="1"
            @input="adjustHeight"
            ref="inputEl"
            class="w-full bg-transparent text-[var(--text)] px-4 py-3.5 outline-none resize-none max-h-40 min-h-[48px] text-sm leading-relaxed" 
            placeholder="输入您想说的话... (Enter 发送，Shift+Enter 换行)" 
          />
        </div>
        <button 
          @click="send" 
          :disabled="streaming || !input.trim()" 
          class="btn-send flex items-center justify-center rounded-2xl w-12 h-12 shrink-0 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:pointer-events-none hover:shadow-purple-500/25 hover:shadow-lg"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5.5 h-5.5 transform rotate-[-15deg]">
            <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";

/* Header and navigation elements */
.btn-back-arrow {
  @apply text-xl p-1.5 hover:bg-white/5 rounded-xl text-zinc-400 hover:text-white transition-colors cursor-pointer;
}
.btn-header-action {
  @apply w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:bg-white/5 hover:text-white transition-all cursor-pointer text-sm font-semibold;
}

/* API configure inputs */
.input { 
  @apply w-full bg-zinc-950/50 border border-white/5 text-[var(--text)] px-3.5 py-2.5 rounded-xl outline-none focus:border-[var(--primary)] transition-all focus:bg-zinc-950/80 focus:shadow-[0_0_15px_rgba(168,85,247,0.15)] text-xs md:text-sm; 
}
.btn-primary-sm { 
  @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer; 
}
.btn-sm { 
  @apply bg-zinc-900 hover:bg-zinc-800 border border-white/5 text-zinc-300 hover:text-white px-3.5 py-2 rounded-xl transition-all cursor-pointer font-bold; 
}

/* Chat Bubbles UI */
.bubble { @apply px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed relative overflow-hidden; }
.bubble-user { 
  @apply bg-gradient-to-br from-purple-600/90 to-indigo-600/90 border border-purple-500/20 text-white rounded-tr-sm; 
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.15);
}
.bubble-ai { 
  @apply bg-zinc-900/45 border border-white/5 text-zinc-100 rounded-tl-sm pl-5;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
/* Side Neon Indicator for AI character */
.bubble-ai::before {
  content: '';
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  width: 3px;
  background: linear-gradient(to bottom, var(--primary), #ec4899);
  border-radius: 0 4px 4px 0;
}

/* Message Hover Buttons */
.action-btn { 
  @apply text-xs bg-zinc-900/90 hover:bg-zinc-800 border border-white/10 hover:border-purple-500/50 rounded-lg p-1.5 text-zinc-300 hover:text-white shadow-lg backdrop-blur-md cursor-pointer transition-all duration-150; 
}

/* Floating Input Action */
.btn-send { 
  @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg shadow-purple-500/10; 
}

/* Markdown styling inside AI bubble */
:deep(.prose-ai) { @apply text-sm leading-relaxed; }
:deep(.prose-ai p) { @apply mb-2.5 last:mb-0; }
:deep(.prose-ai strong) { @apply font-extrabold text-white; }
:deep(.prose-ai em) { @apply italic text-zinc-300; }
:deep(.prose-ai ul) { @apply list-disc pl-5 mb-3; }
:deep(.prose-ai ol) { @apply list-decimal pl-5 mb-3; }
:deep(.prose-ai li) { @apply mb-1; }
:deep(.prose-ai code) { @apply bg-black/40 rounded px-1.5 py-0.5 text-xs font-mono text-pink-400 border border-white/5; }
:deep(.prose-ai pre) { @apply bg-zinc-950/80 border border-white/5 rounded-xl p-3.5 overflow-x-auto text-xs font-mono mb-3.5 whitespace-pre shadow-inner text-zinc-300; }
:deep(.prose-ai h1, .prose-ai h2, .prose-ai h3) { @apply font-bold mb-2 mt-4 text-white; }
:deep(.prose-ai h1) { @apply text-base; }
:deep(.prose-ai h2) { @apply text-sm; }
:deep(.prose-ai h3) { @apply text-xs; }
:deep(.prose-ai blockquote) { @apply border-l-2 border-[var(--primary)] pl-3 italic text-zinc-400 mb-3 bg-white/2 py-1.5 pr-2 rounded-r-lg; }
:deep(.prose-ai a) { @apply text-[var(--primary)] hover:underline font-bold; }
:deep(.prose-ai hr) { @apply border-white/5 my-3.5; }
</style>

