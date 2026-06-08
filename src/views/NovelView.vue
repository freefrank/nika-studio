<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

const props = withDefaults(defineProps<{ standalone?: boolean }>(), { standalone: true })
import { settingsService } from '@/services/settingsService'
import { streamChat } from '@/services/apiService'
import { useCharacterStore } from '@/stores/characterStore'
import type { Character, WorldBook, WorldBookEntry } from '@/types'

const router = useRouter()
const charStore = useCharacterStore()

const fileContent = ref('')
const fileName = ref('')
const encoding = ref('auto')
const fileInputEl = ref<HTMLInputElement | null>(null)
const chapterRegex = ref('第[零一二三四五六七八九十百千\\d]+[章节回幕]')
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
  <div :class="standalone ? 'min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col animate-slide-up pb-10' : 'flex flex-col h-full pb-10'">
    <!-- Header -->
    <header v-if="standalone" class="flex items-center gap-3 px-5 py-3.5 bg-[var(--bg-2)]/85 backdrop-blur-md border-b border-white/5 sticky top-0 z-20 shadow-md">
      <button @click="router.push('/')" class="btn-back-arrow">←</button>
      <span class="font-extrabold text-sm md:text-base tracking-wide text-gradient-primary flex-1">📚 小说转世界书 (Novel to Lorebook)</span>
    </header>

    <div class="flex-1 max-w-4xl mx-auto w-full p-5 flex flex-col gap-6">
      <!-- Upload Drop Zone -->
      <div @dragover.prevent @drop="onDrop"
        class="group border-2 border-dashed border-white/10 hover:border-purple-500/40 bg-zinc-950/20 hover:bg-purple-500/5 rounded-2xl p-10 text-center transition-all duration-300 cursor-pointer shadow-inner flex flex-col items-center justify-center min-h-[180px] hover:scale-[1.005]"
        @click="fileInputEl?.click()">
        <input ref="fileInputEl" type="file" accept=".txt" class="hidden" @change="loadFile" />
        <span class="text-5xl mb-3 block transform group-hover:scale-110 transition-transform duration-300">📄</span>
        <p v-if="fileName" class="font-extrabold text-[var(--primary)] text-sm tracking-wide bg-purple-500/5 border border-purple-500/20 py-1.5 px-4 rounded-xl shadow-sm">{{ fileName }}</p>
        <p v-else class="text-sm font-bold text-zinc-300 group-hover:text-purple-300 transition-colors">拖拽或点击上传小说 .txt 文件</p>
        <p v-if="fileContent" class="text-[10px] text-[var(--text-muted)] mt-2 font-mono bg-zinc-950/40 border border-white/5 px-2.5 py-1 rounded-md">{{ fileContent.length.toLocaleString() }} 字符</p>
      </div>

      <!-- Options Configuration Grid -->
      <div class="glass-card rounded-2xl p-5 border border-white/5 grid grid-cols-1 md:grid-cols-4 gap-4 shadow-md">
        <div class="flex flex-col gap-1.5">
          <label class="label">文件编码</label>
          <select v-model="encoding" class="input cursor-pointer bg-zinc-950">
            <option v-for="e in encodings" :key="e" :value="e" class="bg-zinc-950">{{ e === 'auto' ? '自动检测' : e }}</option>
          </select>
        </div>
        
        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="label">章节识别正则 (Regex)</label>
          <div class="flex gap-2">
            <input v-model="chapterRegex" class="input flex-1 font-mono text-xs" />
            <button @click="detectChapters" :disabled="!fileContent" class="btn-secondary whitespace-nowrap text-xs font-bold px-3.5 rounded-xl">识别章节</button>
          </div>
        </div>
        
        <div class="flex flex-col gap-1.5">
          <label class="label">分段字数大小</label>
          <select v-model="splitSize" class="input cursor-pointer bg-zinc-950">
            <option :value="1500" class="bg-zinc-950">1500字</option>
            <option :value="3000" class="bg-zinc-950">3000字</option>
            <option :value="5000" class="bg-zinc-950">5000字</option>
          </select>
        </div>
      </div>

      <!-- Incremental Mode Banner -->
      <div class="glass-card rounded-2xl p-4 border border-white/5 flex items-center justify-between shadow-sm">
        <div class="flex items-center gap-3">
          <span class="text-xl">🔄</span>
          <div class="flex flex-col">
            <span class="text-xs font-bold text-zinc-100">智能增量提取模式</span>
            <span class="text-[10px] text-[var(--text-muted)]">开启后将自动跳过已存在的同名/同关键词条目，仅做内容更新</span>
          </div>
        </div>
        <label class="relative inline-flex items-center cursor-pointer select-none">
          <input type="checkbox" v-model="incrementalMode" class="accent-[var(--primary)] w-4 h-4" />
        </label>
      </div>

      <!-- Categories Configuration -->
      <div class="glass-card rounded-2xl overflow-hidden border border-white/5 shadow-sm">
        <button @click="showCategories = !showCategories"
          class="w-full px-5 py-4 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] hover:bg-white/5 transition-colors cursor-pointer border-b border-white/5 bg-zinc-900/10">
          <span class="flex items-center gap-1.5">📂 提取范畴配置（{{ categories.filter(c=>c.enabled).length }}/{{ categories.length }} 启用）</span>
          <span>{{ showCategories ? '▲ 收起' : '▼ 展开' }}</span>
        </button>
        
        <div v-if="showCategories" class="px-5 pb-5 flex flex-col gap-3 pt-3">
          <div v-for="(cat, i) in categories" :key="cat.name"
            class="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
            <label class="flex items-center gap-2 shrink-0 cursor-pointer">
              <input type="checkbox" v-model="cat.enabled" class="accent-[var(--primary)] w-4 h-4" />
              <span class="text-xs font-bold text-zinc-200 w-16">{{ cat.name }}</span>
            </label>
            <input v-model="cat.guide" class="input flex-1 py-1.5 text-xs" placeholder="提取指导..." />
            <button v-if="!['角色','地点','组织'].includes(cat.name)"
              @click="removeCategory(i)" class="text-red-400 hover:text-red-300 text-xs shrink-0 cursor-pointer p-1">✕</button>
          </div>
          
          <!-- Add category -->
          <div class="flex gap-2 mt-3 pt-3 border-t border-white/5">
            <input v-model="newCatName" @keydown.enter.prevent="addCategory"
              class="input flex-1 text-xs" placeholder="新增设定分类 (例如: 武器、法宝)..." />
            <button @click="addCategory" class="btn-secondary text-xs px-4 rounded-xl font-bold">+ 添加分类</button>
            <button @click="categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES))"
              class="btn-secondary text-xs px-4 rounded-xl font-bold text-zinc-400 border-dashed">重置默认</button>
          </div>
        </div>
      </div>

      <!-- Chapters Preview -->
      <div v-if="chapters.length" class="glass-card rounded-2xl p-5 border border-white/5 shadow-sm animate-fade-in">
        <h4 class="text-[10px] font-bold text-zinc-400 mb-3 uppercase tracking-wider">自动识别到 {{ chapters.length }} 个章节</h4>
        <div class="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
          <span v-for="(c, idx) in chapters.slice(0, 20)" :key="c.title + '-' + idx" class="text-[10px] font-bold bg-purple-500/10 text-purple-300 border border-purple-500/10 px-2.5 py-1 rounded-lg">{{ c.title }}</span>
          <span v-if="chapters.length > 20" class="text-xs text-[var(--text-muted)] flex items-center pl-1 font-bold">...等其余 {{ chapters.length - 20 }} 个章节</span>
        </div>
      </div>

      <!-- Action Button -->
      <div class="flex gap-3 shrink-0">
        <button @click="generateWorldbook" :disabled="!fileContent || processing" class="btn-primary flex-1 py-3 text-sm font-extrabold shadow-lg shadow-purple-500/20">
          🔮 开始 AI 智能解析世界设定
        </button>
        <button v-if="processing" @click="stopProcessing" class="btn-danger py-3 text-sm font-extrabold px-6 rounded-xl shadow-lg shadow-red-500/10">
          ■ 停止生成
        </button>
      </div>

      <!-- Progress Tracking -->
      <div v-if="processing || progress.total > 0" class="glass-card p-5 rounded-2xl border border-white/5 shadow-sm animate-fade-in flex flex-col gap-2">
        <div class="flex justify-between text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
          <span>{{ processing ? 'AI 正在全力提取剧情中...' : '设定提取已完成' }} (已处理：{{ progress.current }}/{{ progress.total }})</span>
          <span class="text-purple-400 font-mono font-bold">{{ progressPct }}%</span>
        </div>
        <div class="h-2.5 bg-zinc-950 rounded-full overflow-hidden border border-white/5 shadow-inner">
          <div class="h-full bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 transition-all duration-300 animate-pulse" :style="{ width: progressPct + '%' }" />
        </div>
      </div>

      <!-- Worldbook Extraction Results -->
      <div v-if="worldbook.entries.length" class="glass-card rounded-3xl p-5 border border-white/5 flex flex-col gap-4 shadow-xl animate-fade-in shadow-black/35">
        <div class="flex justify-between items-center border-b border-white/5 pb-3">
          <span class="font-extrabold text-sm tracking-wide text-purple-300">🎉 成功提取出 {{ worldbook.entries.length }} 条世界书设定</span>
          <div class="flex gap-2">
            <button @click="exportWorldbook" class="btn-secondary text-xs py-2 px-4 rounded-xl font-bold">📂 导出 JSON 世界书</button>
            <button @click="saveToLibrary" class="btn-primary text-xs py-2 px-4 rounded-xl font-extrabold shadow-lg shadow-purple-500/15">💾 存入角色库</button>
          </div>
        </div>
        
        <div class="flex flex-col gap-2.5 max-h-[360px] overflow-y-auto pr-1">
          <div v-for="entry in worldbook.entries" :key="entry.id"
            class="bg-zinc-900/35 border border-white/5 rounded-2xl p-4 text-xs shadow-inner hover:border-purple-500/10 transition-all animate-fade-in">
            <div class="text-[var(--primary)] font-extrabold mb-1.5 flex items-center justify-between">
              <span class="text-zinc-100 text-sm">{{ entry.comment || '未命名分类' }}</span>
              <span class="text-[9px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/20 px-2 py-0.5 rounded-md font-mono">🔑 {{ entry.keys.join(', ') || '(无触发词)' }}</span>
            </div>
            <p class="text-[var(--text-muted)] leading-relaxed select-text mt-2 border-t border-white/3 pt-2 font-medium">{{ entry.content }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";

.btn-back-arrow {
  @apply text-xl p-1.5 hover:bg-white/5 rounded-xl text-zinc-400 hover:text-white transition-colors cursor-pointer;
}

/* Form configurations */
.input { 
  @apply bg-zinc-950/40 border border-white/5 text-[var(--text)] px-3.5 py-2.5 rounded-xl outline-none focus:border-[var(--primary)] transition-all focus:bg-zinc-900/70 focus:shadow-[0_0_15px_rgba(168,85,247,0.15)] text-xs md:text-sm; 
}
.btn-primary { 
  @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl transition-all active:scale-95 disabled:opacity-50 cursor-pointer; 
}
.btn-secondary { 
  @apply bg-zinc-900/60 hover:bg-zinc-800/80 border border-white/5 hover:border-white/10 text-[var(--text)] px-4 py-2.5 rounded-xl transition-all cursor-pointer font-bold; 
}
.btn-danger { 
  @apply bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white px-5 rounded-xl font-bold transition-all active:scale-95 cursor-pointer; 
}
.label { 
  @apply text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider select-none; 
}
</style>
