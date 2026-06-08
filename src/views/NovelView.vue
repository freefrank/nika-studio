<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { settingsService } from '@/services/settingsService'
import { streamChat } from '@/services/apiService'
import { useCharacterStore } from '@/stores/characterStore'
import type { Character, WorldBook, WorldBookEntry } from '@/types'

const router = useRouter()
const charStore = useCharacterStore()

const fileContent = ref('')
const fileName = ref('')
const encoding = ref('auto')
const chapterRegex = ref('第[零一二三四五六七八九十百千\\d]+章')
const chapters = ref<{ title: string; content: string }[]>([])
const worldbook = ref<WorldBook>({ name: '', entries: [] })
const processing = ref(false)
const progress = ref({ current: 0, total: 0 })
const abortCtrl = ref<AbortController | null>(null)
const splitSize = ref(3000)
const incrementalMode = ref(true) // 增量模式：只输出新增/变更条目

// 自定义分类系统
interface Category {
  name: string
  enabled: boolean
  guide: string
}

const DEFAULT_CATEGORIES: Category[] = [
  { name: '角色', enabled: true, guide: '角色描述，包含名字、性别、外貌、性格、背景' },
  { name: '地点', enabled: true, guide: '地点描述，包含名称、位置、特征' },
  { name: '组织', enabled: true, guide: '组织描述，包含名称、性质、成员、目标' },
  { name: '道具', enabled: false, guide: '道具描述，包含名称、类型、功能' },
  { name: '剧情大纲', enabled: false, guide: '章节剧情概要，主要事件、转折点' },
]

const categories = ref<Category[]>(JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)))
const showCategories = ref(false)
const newCatName = ref('')

function addCategory() {
  const n = newCatName.value.trim()
  if (!n || categories.value.find(c => c.name === n)) return
  categories.value.push({ name: n, enabled: true, guide: `${n}的详细描述` })
  newCatName.value = ''
}

function removeCategory(i: number) {
  if (categories.value[i].enabled && categories.value.filter(c => c.enabled).length <= 1) return
  categories.value.splice(i, 1)
}

const encodings = ['auto', 'UTF-8', 'GBK', 'GB2312', 'Big5']

const MOJIBAKE_MARKERS = [
  /\u00c3[\u0080-\u00bf]/g,
  /\u00c2[\u0080-\u00bf]/g,
  /\u00e2[\u0080-\u00bf]{1,2}/g,
  /[\u00c2\u00c3\u00e2\u20ac\u2122\u0152\u0153\u0160\u0161\u017d\u017e]/g,
  /[\ue000-\uf8ff]/g,
]

function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0
}

function scoreDecodedText(text: string) {
  const sample = text.slice(0, 200_000)
  const length = Math.max(sample.length, 1)
  const replacementCount = countMatches(sample, /\ufffd/g)
  const mojibakeCount = MOJIBAKE_MARKERS.reduce((total, pattern) => total + countMatches(sample, pattern), 0)
  const chineseCount = countMatches(sample, /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)
  const controlCount = countMatches(sample, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g)
  const symbolNoiseCount = countMatches(sample, /[^\s\w\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef.,!?;:'"()[\]{}<>/@#$%^&*+=|\\~-]/g)

  const replacementRatio = replacementCount / length
  const mojibakeRatio = mojibakeCount / length
  const chineseRatio = chineseCount / length
  const controlRatio = controlCount / length
  const symbolNoiseRatio = symbolNoiseCount / length

  return (
    replacementRatio * 10_000 +
    mojibakeRatio * 6_000 +
    controlRatio * 8_000 +
    symbolNoiseRatio * 1_000 -
    Math.min(chineseRatio, 0.8) * 120
  )
}

function readFileAsText(file: File, enc: string) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = e => resolve(e.target!.result as string)
    r.onerror = () => reject(r.error ?? new Error(`Failed to read file as ${enc}`))
    r.readAsText(file, enc)
  })
}

async function detectBestEncoding(file: File) {
  const candidates = ['UTF-8', 'GBK', 'GB2312', 'Big5']
  const scores = await Promise.all(candidates.map(async enc => {
    try {
      const text = await readFileAsText(file, enc)
      return { enc, score: scoreDecodedText(text) }
    } catch {
      return { enc, score: Infinity }
    }
  }))
  return scores.reduce((best, current) => current.score < best.score ? current : best).enc
}

async function loadFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  fileName.value = file.name
  const enc = encoding.value === 'auto' ? await detectBestEncoding(file) : encoding.value
  const reader = new FileReader()
  reader.onload = ev => { fileContent.value = ev.target!.result as string }
  reader.readAsText(file, enc)
}

async function onDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  const inp = { target: { files: [file] } } as unknown as Event
  await loadFile(inp)
}

function detectChapters() {
  if (!fileContent.value) return
  const re = new RegExp(`(${chapterRegex.value})`, 'gm')
  const parts = fileContent.value.split(re)
  const result: { title: string; content: string }[] = []
  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i].trim()
    const content = (parts[i + 1] ?? '').trim()
    if (content.length > 50) result.push({ title, content })
  }
  chapters.value = result
}

function chunkText(text: string, size: number) {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size))
  return chunks
}

function buildPrompt(seg: string): string {
  const enabledCats = categories.value.filter(c => c.enabled)
  const catGuide = enabledCats.map(c => `- ${c.name}：${c.guide}`).join('\n')
  const incrementalNote = incrementalMode.value
    ? '（增量模式：只输出新发现的条目，如已存在同名条目则跳过）'
    : ''

  return `请根据以下小说片段，提取世界书条目${incrementalNote}。
分类包括：
${catGuide}

输出JSON数组格式：
[{"category":"分类名","keys":["关键词"],"comment":"条目名","content":"详细内容（100字以上）"}]
只输出JSON数组。

片段：
${seg.slice(0, 2000)}`
}

async function generateWorldbook() {
  if (!fileContent.value) return
  const cfg = settingsService.get().apiConfig
  processing.value = true
  abortCtrl.value = new AbortController()
  if (!incrementalMode.value) {
    worldbook.value = { name: fileName.value.replace(/\.[^.]+$/, ''), entries: [] }
  } else if (!worldbook.value.name) {
    worldbook.value.name = fileName.value.replace(/\.[^.]+$/, '')
  }

  const segments = chapters.value.length > 0
    ? chapters.value.map(c => `【${c.title}】\n${c.content}`)
    : chunkText(fileContent.value, splitSize.value)

  progress.value = { current: 0, total: segments.length }

  for (const seg of segments) {
    if (abortCtrl.value.signal.aborted) break
    progress.value.current++
    try {
      let json = ''
      await streamChat(cfg, [{ role: 'user', content: buildPrompt(seg) }], d => { json += d }, abortCtrl.value.signal)
      const match = json.match(/\[[\s\S]*\]/)
      if (match) {
        const entries: { category?: string; keys: string[]; comment?: string; content: string }[] = JSON.parse(match[0])
        for (const e of entries) {
          // 增量模式：跳过重复条目
          if (incrementalMode.value) {
            const dup = worldbook.value.entries.find(x =>
              x.comment === (e.comment || '') || x.keys.some(k => e.keys.includes(k))
            )
            if (dup) { dup.content = e.content; continue }
          }
          worldbook.value.entries.push({
            id: crypto.randomUUID(), keys: e.keys,
            content: e.content, enabled: true,
            insertion_order: worldbook.value.entries.length,
            comment: e.comment || e.category || '',
            selective: false, secondary_keys: [],
            constant: false, position: 'before_char', parentId: null,
          } satisfies WorldBookEntry)
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') break
    }
  }
  processing.value = false
}

function stopProcessing() { abortCtrl.value?.abort() }

function exportWorldbook() {
  const blob = new Blob([JSON.stringify(worldbook.value, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${worldbook.value.name || 'worldbook'}.json`
  a.click()
}

async function saveToLibrary() {
  const char: Character = {
    id: crypto.randomUUID(), name: worldbook.value.name || '新角色',
    avatar: undefined, tags: ['世界书'], isFavorite: false,
    createdAt: Date.now(), updatedAt: Date.now(),
    cardData: {
      spec: 'chara_card_v2', spec_version: '2.0',
      data: {
        name: worldbook.value.name, description: '', personality: '',
        scenario: '', first_mes: '', mes_example: '',
        creator_notes: '', system_prompt: '', post_history_instructions: '',
        tags: [], creator: '', character_version: '',
        character_book: worldbook.value,
      }
    }
  }
  await charStore.save(char)
  router.push('/')
}

const progressPct = computed(() =>
  progress.value.total ? Math.round(progress.value.current / progress.value.total * 100) : 0
)
</script>

<template>
  <div class="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col animate-slide-up">
    <div class="flex items-center gap-3 px-4 py-3 bg-[var(--bg-2)]/80 backdrop-blur-md border-b border-white/5 sticky top-0 z-20">
      <button @click="router.push('/')" class="text-xl hover:text-[var(--primary)] transition-colors cursor-pointer">←</button>
      <span class="font-bold text-sm md:text-base tracking-wide flex-1">📚 小说转世界书</span>
    </div>

    <div class="flex-1 max-w-4xl mx-auto w-full p-5 flex flex-col gap-6">
      <!-- Upload -->
      <div @dragover.prevent @drop="onDrop"
        class="border-2 border-dashed border-white/10 hover:border-purple-500/50 bg-zinc-950/20 hover:bg-purple-500/5 rounded-2xl p-10 text-center transition-all cursor-pointer shadow-inner flex flex-col items-center justify-center min-h-[160px]"
        @click="($refs.fileInput as HTMLInputElement).click()">
        <input ref="fileInput" type="file" accept=".txt" class="hidden" @change="loadFile" />
        <p class="text-4xl mb-3">📄</p>
        <p v-if="fileName" class="font-bold text-[var(--primary)] text-sm tracking-wide">{{ fileName }}</p>
        <p v-else class="text-sm font-semibold text-[var(--text-muted)]">拖拽或点击上传 .txt 小说文件</p>
        <p v-if="fileContent" class="text-xs text-[var(--text-muted)] mt-1.5 font-mono">{{ fileContent.length.toLocaleString() }} 字符</p>
      </div>

      <!-- Options -->
      <div class="glass-panel rounded-2xl p-5 border border-white/5 flex flex-wrap gap-4 shadow-sm">
        <div class="flex flex-col gap-1.5">
          <label class="label">文件编码</label>
          <select v-model="encoding" class="input w-36 cursor-pointer">
            <option v-for="e in encodings" :key="e" :value="e" class="bg-zinc-950">{{ e === 'auto' ? '自动检测' : e }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1.5 flex-1 min-w-48">
          <label class="label">章节识别正则</label>
          <div class="flex gap-2">
            <input v-model="chapterRegex" class="input flex-1" />
            <button @click="detectChapters" :disabled="!fileContent" class="btn-sm whitespace-nowrap px-4 py-2 text-xs font-semibold rounded-xl">识别章节</button>
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="label">分段字数大小</label>
          <select v-model="splitSize" class="input w-36 cursor-pointer">
            <option :value="1500" class="bg-zinc-950">1500字</option>
            <option :value="3000" class="bg-zinc-950">3000字</option>
            <option :value="5000" class="bg-zinc-950">5000字</option>
          </select>
        </div>
        <!-- 增量模式 -->
        <div class="flex flex-col gap-1.5 justify-end mb-1">
          <label class="flex items-center gap-2 cursor-pointer text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <input type="checkbox" v-model="incrementalMode" class="accent-[var(--primary)] w-4 h-4" />
            <span>增量模式（跳过重复）</span>
          </label>
        </div>
      </div>

      <!-- 自定义分类 -->
      <div class="glass-panel rounded-2xl overflow-hidden border border-white/5 shadow-sm">
        <button @click="showCategories = !showCategories"
          class="w-full px-5 py-4 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] hover:bg-white/5 transition-colors cursor-pointer">
          <span>📂 提取分类配置（{{ categories.filter(c=>c.enabled).length }}/{{ categories.length }} 启用）</span>
          <span>{{ showCategories ? '▲' : '▼' }}</span>
        </button>
        <div v-if="showCategories" class="px-5 pb-5 flex flex-col gap-3">
          <div v-for="(cat, i) in categories" :key="cat.name"
            class="flex items-start gap-3 py-3 border-b border-white/5 last:border-0">
            <label class="flex items-center gap-2 shrink-0 mt-1 cursor-pointer">
              <input type="checkbox" v-model="cat.enabled" class="accent-[var(--primary)] w-4 h-4" />
              <span class="text-xs font-bold text-white w-16">{{ cat.name }}</span>
            </label>
            <input v-model="cat.guide" class="input flex-1 text-xs" placeholder="提取指导..." />
            <button v-if="!['角色','地点','组织'].includes(cat.name)"
              @click="removeCategory(i)" class="text-red-400 hover:text-red-300 text-xs mt-2 shrink-0 cursor-pointer">✕</button>
          </div>
          <!-- 新增分类 -->
          <div class="flex gap-2 mt-2">
            <input v-model="newCatName" @keydown.enter.prevent="addCategory"
              class="input flex-1 text-xs" placeholder="新分类名称，Enter添加" />
            <button @click="addCategory" class="btn-sm text-xs px-4 py-2.5 rounded-xl">+ 添加</button>
            <button @click="categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES))"
              class="btn-sm text-xs px-4 py-2.5 rounded-xl text-[var(--text-muted)]">重置</button>
          </div>
        </div>
      </div>

      <!-- Chapters preview -->
      <div v-if="chapters.length" class="glass-panel rounded-2xl p-5 border border-white/5 shadow-sm">
        <p class="text-xs font-semibold text-[var(--text-muted)] mb-3 uppercase tracking-wider">识别到 {{ chapters.length }} 个章节</p>
        <div class="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-1">
          <span v-for="c in chapters.slice(0,20)" :key="c.title" class="text-[10px] font-medium bg-purple-500/10 text-purple-300 border border-purple-500/10 px-2 py-1 rounded-md">{{ c.title }}</span>
          <span v-if="chapters.length > 20" class="text-xs text-[var(--text-muted)] flex items-center pl-1 font-semibold">...还有 {{ chapters.length - 20 }} 章</span>
        </div>
      </div>

      <!-- Action -->
      <div class="flex gap-3">
        <button @click="generateWorldbook" :disabled="!fileContent || processing" class="btn-primary flex-1 py-3 text-sm font-bold">
          🔮 AI生成世界书
        </button>
        <button v-if="processing" @click="stopProcessing" class="btn-danger py-3 text-sm font-bold">■ 停止生成</button>
      </div>

      <!-- Progress -->
      <div v-if="processing || progress.total > 0" class="glass-panel p-5 rounded-2xl border border-white/5 shadow-sm">
        <div class="flex justify-between text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wider">
          <span>{{ processing ? '正在处理章节...' : '处理已完成' }} {{ progress.current }}/{{ progress.total }}</span>
          <span class="text-purple-400 font-mono">{{ progressPct }}%</span>
        </div>
        <div class="h-2 bg-zinc-900 rounded-full overflow-hidden border border-white/5 shadow-inner">
          <div class="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300" :style="{ width: progressPct + '%' }" />
        </div>
      </div>

      <!-- Worldbook result -->
      <div v-if="worldbook.entries.length" class="glass-panel rounded-2xl p-5 border border-white/5 flex flex-col gap-4 shadow-lg shadow-black/25">
        <div class="flex justify-between items-center">
          <span class="font-bold text-sm tracking-wide text-purple-400">{{ worldbook.entries.length }} 条提取的世界书条目</span>
          <div class="flex gap-2">
            <button @click="exportWorldbook" class="btn-sm text-xs py-2 px-4 rounded-xl">导出 JSON</button>
            <button @click="saveToLibrary" class="btn-primary text-xs py-2 px-4 rounded-xl shadow-lg shadow-purple-500/10">保存到角色库</button>
          </div>
        </div>
        <div class="flex flex-col gap-2.5 max-h-80 overflow-y-auto pr-1">
          <div v-for="entry in worldbook.entries.slice(0, 30)" :key="entry.id"
            class="bg-zinc-900/50 border border-white/5 rounded-xl p-3.5 text-xs shadow-inner">
            <div class="text-[var(--primary)] font-bold mb-1 flex items-center gap-2">
              <span>{{ entry.comment || '—' }}</span>
              <span class="text-[var(--text-muted)] text-[10px] bg-white/5 px-2 py-0.5 rounded-md border border-white/5 font-mono">🔑 {{ entry.keys.join(', ') }}</span>
            </div>
            <div class="text-[var(--text-muted)] leading-relaxed line-clamp-2 mt-1.5">{{ entry.content }}</div>
          </div>
          <p v-if="worldbook.entries.length > 30" class="text-xs text-center text-[var(--text-muted)] font-semibold py-2">
            ...还有 {{ worldbook.entries.length - 30 }} 条条目已保存
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";
.input { @apply bg-zinc-900/50 border border-white/5 text-[var(--text)] px-3.5 py-2.5 rounded-xl outline-none focus:border-[var(--primary)] transition-all focus:bg-zinc-900/80 focus:shadow-[0_0_15px_rgba(168,85,247,0.15)] text-sm; }
.btn-primary { @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl transition-all shadow-md shadow-purple-500/10 hover:shadow-purple-500/20 active:scale-95 disabled:opacity-50 cursor-pointer; }
.btn-sm { @apply bg-zinc-900/50 hover:bg-zinc-800/80 text-[var(--text)] px-3.5 py-2 rounded-xl border border-white/5 hover:border-white/10 transition-all cursor-pointer text-xs font-semibold; }
.btn-danger { @apply bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white px-5 rounded-xl font-bold transition-all active:scale-95 cursor-pointer; }
.label { @apply text-xs text-[var(--text-muted)] font-semibold uppercase tracking-wider; }
</style>
