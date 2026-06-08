<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCharacterStore } from '@/stores/characterStore'
import type { Character, WorldBookEntry } from '@/types'
import { exportCardAsJson, exportCardAsPng, exportLorebook } from '@/services/cardIO'
import { streamChat as _streamChat, chat } from '@/services/apiService'
import { settingsService } from '@/services/settingsService'

const route = useRoute()
const router = useRouter()
const store = useCharacterStore()

const activeTab = ref<'basic' | 'dialogue' | 'greetings' | 'meta' | 'worldbook' | 'regex'>('basic')
const saving = ref(false)
const aiLoading = ref<string | null>(null)
const translateLoading = ref(false)
const nameModal = ref(false)
const nameList = ref<string[]>([])
const nameLoading = ref(false)
const translateSnapshot = ref<string | null>(null)
// AI前端美化
const beautifyModal = ref(false)
const beautifyCount = ref(3)
const beautifyLines = ref(80)
const beautifyReq = ref('')
const beautifyLoading = ref(false)
const beautifyStyles = ref<string[]>([])
const beautifyPreviewIdx = ref<number | null>(null)
// expose uuid for template use
const newUUID = () => crypto.randomUUID()

const blank = (): Character => ({
  id: crypto.randomUUID(), name: '新角色', avatar: undefined,
  tags: [], isFavorite: false, createdAt: Date.now(), updatedAt: Date.now(),
  cardData: {
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
      name: '', description: '', personality: '', scenario: '',
      first_mes: '', mes_example: '', creator_notes: '',
      system_prompt: '', post_history_instructions: '',
      tags: [], creator: '', character_version: '',
    }
  }
})

const char = ref<Character>(blank())
const tagInput = ref('')

onMounted(async () => {
  const id = route.params.id as string | undefined
  if (id) {
    if (!store.characters.length) await store.load()
    const found = store.characters.find(c => c.id === id)
    if (!found) { router.push('/'); return }
    char.value = JSON.parse(JSON.stringify(found))
  }
})

const d = computed(() => char.value.cardData.data)

function onAvatarChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = ev => { char.value.avatar = ev.target?.result as string }
  reader.readAsDataURL(file)
}

function addTag() {
  const t = tagInput.value.trim()
  if (t && !char.value.tags.includes(t)) char.value.tags.push(t)
  tagInput.value = ''
}
function removeTag(t: string) { char.value.tags = char.value.tags.filter(x => x !== t) }

function addWbEntry() {
  const wb = d.value.character_book ??= { name: '', entries: [] }
  wb.entries.push({ id: crypto.randomUUID(), keys: [], content: '', enabled: true, insertion_order: wb.entries.length, comment: '', selective: false, secondary_keys: [], constant: false, position: 'before_char', parentId: null } satisfies WorldBookEntry)
}
function removeWbEntry(id: string) {
  if (d.value.character_book) d.value.character_book.entries = d.value.character_book.entries.filter(e => e.id !== id)
}
function wbKeys(entry: WorldBookEntry) { return entry.keys.join(', ') }
function updateWbKeys(entry: WorldBookEntry, val: string) { entry.keys = val.split(',').map(s => s.trim()).filter(Boolean) }

async function save() {
  saving.value = true
  try {
    char.value.name = d.value.name || char.value.name
    await store.save(char.value)
    router.push('/')
  } catch (e) {
    alert('保存失败: ' + (e as Error).message)
  } finally {
    saving.value = false
  }
}

// ── AI 一键生成角色 ──────────────────────────────────────────────
async function aiGenerate() {
  const cfg = settingsService.get().apiConfig
  if (!cfg.apiKey && cfg.provider !== 'local') { alert('请先在设置中配置API Key'); return }
  aiLoading.value = 'all'
  const prompt = `请生成一个完整的AI角色卡（中文），包含以下字段，以JSON格式输出：
{
  "name": "角色名",
  "description": "详细描述（500字以上）",
  "personality": "性格特点",
  "scenario": "故事背景",
  "first_mes": "开场白（角色视角，200字以上）",
  "mes_example": "3组对话示例，格式: <START>\\n{{user}}: ...\\n{{char}}: ...",
  "system_prompt": "系统指令（让AI扮演此角色的指令）",
  "tags": ["标签1", "标签2"]
}

要求：${d.value.name ? `角色名：${d.value.name}，` : ''}风格：${char.value.tags.join('/') || '通用'}，有深度，有个性。只输出JSON，不要其他文字。`

  try {
    const result = await chat(cfg, [{ role: 'user', content: prompt }])
    const match = result.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('无法解析AI响应')
    const data = JSON.parse(match[0])
    for (const k of ['name','description','personality','scenario','first_mes','mes_example','system_prompt'] as const) {
      if (data[k]) (d.value as Record<string, unknown>)[k] = data[k]
    }
    if (Array.isArray(data.tags)) char.value.tags = data.tags
    if (data.name) char.value.name = data.name
  } catch (e) { alert('AI生成失败: ' + (e as Error).message) }
  aiLoading.value = null
}

// ── AI 补全单个字段 ──────────────────────────────────────────────
async function aiField(field: string, label: string) {
  const cfg = settingsService.get().apiConfig
  if (!cfg.apiKey && cfg.provider !== 'local') { alert('请先在设置中配置API Key'); return }
  aiLoading.value = field
  const context = `角色名：${d.value.name}\n已有描述：${d.value.description?.slice(0,200) || '无'}`
  const prompts: Record<string, string> = {
    description: `请为以下角色生成详细描述（外貌、背景、技能，500字以上）：\n${context}`,
    personality: `请为以下角色生成性格特点描述（150字）：\n${context}`,
    scenario: `请为以下角色生成故事背景场景（200字）：\n${context}`,
    first_mes: `请为以下角色生成开场白（角色第一人称，200字以上，生动有趣）：\n${context}`,
    mes_example: `请为以下角色生成3组对话示例，格式：<START>\n{{user}}: ...\n{{char}}: ...\n：\n${context}`,
    system_prompt: `请为以下角色生成系统提示词（让AI扮演此角色的指令，简洁有效）：\n${context}`,
  }
  try {
    const result = await chat(cfg, [{ role: 'user', content: prompts[field] || `请生成角色的${label}：\n${context}` }])
    ;(d.value as Record<string, unknown>)[field] = result.trim()
  } catch (e) { alert(`AI生成${label}失败: ` + (e as Error).message) }
  aiLoading.value = null
}

// ── 一键翻译（含撤销） ─────────────────────────────────────────
async function translate(toLang: 'zh' | 'en') {
  const cfg = settingsService.get().apiConfig
  if (!cfg.apiKey && cfg.provider !== 'local') { alert('请先在设置中配置API Key'); return }
  translateLoading.value = true
  // 保存快照用于撤销
  translateSnapshot.value = JSON.stringify(char.value.cardData.data)
  const fields = { name: d.value.name, description: d.value.description, personality: d.value.personality, scenario: d.value.scenario, first_mes: d.value.first_mes, mes_example: d.value.mes_example, system_prompt: d.value.system_prompt }
  const wbTexts = (d.value.character_book?.entries ?? []).map((e, i) => ({ i, keys: e.keys.join(', '), content: e.content.slice(0, 500) }))
  const prompt = `请将以下JSON的所有字符串值翻译为${toLang === 'zh' ? '中文' : 'English'}。不翻译 {{user}} {{char}} <START>。只输出JSON：\n${JSON.stringify({ fields, wb: wbTexts }, null, 2)}`
  try {
    const result = await chat(cfg, [{ role: 'user', content: prompt }])
    const match = result.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('无法解析响应')
    const t = JSON.parse(match[0])
    if (t.fields) for (const k of Object.keys(t.fields)) if (t.fields[k]) (d.value as Record<string, unknown>)[k] = t.fields[k]
    if (t.wb && d.value.character_book) {
      for (const item of t.wb as { i: number; keys?: string; content?: string }[]) {
        const entry = d.value.character_book.entries[item.i]
        if (!entry) continue
        if (item.keys) entry.keys = item.keys.split(',').map((s: string) => s.trim()).filter(Boolean)
        if (item.content) entry.content = item.content
      }
    }
  } catch (e) { alert('翻译失败: ' + (e as Error).message); translateSnapshot.value = null }
  translateLoading.value = false
}

function undoTranslate() {
  if (!translateSnapshot.value) return
  char.value.cardData.data = JSON.parse(translateSnapshot.value)
  translateSnapshot.value = null
}

// ── 名字生成器 ──────────────────────────────────────────────────
async function generateNames() {
  const cfg = settingsService.get().apiConfig
  if (!cfg.apiKey && cfg.provider !== 'local') { alert('请先在设置中配置API Key'); return }
  nameLoading.value = true
  nameModal.value = true
  const prompt = `请为角色生成8个有特色的名字，风格：${char.value.tags.join('/') || '通用'}。只输出名字列表，每行一个，不要编号或其他文字。`
  try {
    const result = await chat(cfg, [{ role: 'user', content: prompt }])
    nameList.value = result.trim().split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8)
  } catch (e) { alert('生成失败: ' + (e as Error).message); nameModal.value = false }
  nameLoading.value = false
}
function selectName(name: string) { d.value.name = name; char.value.name = name; nameModal.value = false }

// ── AI世界书生成 ──────────────────────────────────────────────────
async function aiGenWorldbook() {
  const cfg = settingsService.get().apiConfig
  if (!cfg.apiKey && cfg.provider !== 'local') { alert('请先在设置中配置API Key'); return }
  aiLoading.value = 'worldbook'
  const prompt = `根据以下角色信息，生成5个世界书条目（角色、地点或关键概念），以JSON数组格式输出：
[{"keys":["关键词1","关键词2"],"comment":"条目名","content":"详细内容（100字以上）"}]
只输出JSON数组，不要其他文字。

角色信息：
名称：${d.value.name}
描述：${d.value.description?.slice(0,500) || '无'}`
  try {
    const result = await chat(cfg, [{ role: 'user', content: prompt }])
    const match = result.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('无法解析响应')
    const entries: { keys: string[]; comment: string; content: string }[] = JSON.parse(match[0])
    const wb = d.value.character_book ??= { name: '', entries: [] }
    for (const e of entries) {
      wb.entries.push({ id: crypto.randomUUID(), keys: e.keys, content: e.content, enabled: true, insertion_order: wb.entries.length, comment: e.comment, selective: false, secondary_keys: [], constant: false, position: 'before_char', parentId: null })
    }
  } catch (e) { alert('AI生成世界书失败: ' + (e as Error).message) }
  aiLoading.value = null
}

// ── AI前端美化 ─────────────────────────────────────────────────────
async function runBeautify() {
  const cfg = settingsService.get().apiConfig
  if (!cfg.apiKey && cfg.provider !== 'local') { alert('请先在设置中配置API Key'); return }
  beautifyLoading.value = true
  beautifyStyles.value = []
  const charInfo = `角色名：${d.value.name}\n性格：${d.value.personality?.slice(0,100) || '无'}\n描述：${d.value.description?.slice(0,200) || '无'}`
  const prompt = `请生成${beautifyCount.value}套精美的HTML对话界面样式片段，用于AI聊天前端展示。
每套样式用 ===STYLE_START=== 开头，===STYLE_END=== 结尾包裹。
要求：每套不超过${beautifyLines.value}行，包含角色信息区和消息气泡CSS，暗色主题。${beautifyReq.value ? '\n额外要求：' + beautifyReq.value : ''}
角色信息：${charInfo}`
  try {
    const result = await chat(cfg, [{ role: 'user', content: prompt }])
    const parts = result.split(/===STYLE_START===/)
    const styles = parts.slice(1).map(p => p.split('===STYLE_END===')[0].trim()).filter(Boolean)
    beautifyStyles.value = styles.length ? styles : [result.trim()]
  } catch (e) { alert('AI前端美化失败: ' + (e as Error).message) }
  beautifyLoading.value = false
}

function injectBeautifyStyle(style: string) {
  d.value.system_prompt = (d.value.system_prompt || '') + '\n\n[系统指令]:\n' + style
  beautifyModal.value = false
}
</script>

<template>
  <div class="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col animate-slide-up">
    <!-- Header Toolbar -->
    <header class="sticky top-0 z-30 w-full glass-panel border-b border-white/5 px-4 py-3 flex items-center justify-between shadow-lg shadow-black/15 flex-wrap gap-3">
      <div class="flex items-center gap-3">
        <button @click="router.back()" class="btn-secondary py-2 px-3.5 text-xs font-bold rounded-xl flex items-center gap-1">
          <span>←</span> 返回
        </button>
        <span class="font-extrabold text-sm md:text-base tracking-wide text-gradient-primary truncate max-w-[150px] md:max-w-[240px]">{{ d.name || '新角色' }}</span>
      </div>

      <!-- Toolbar Actions Group -->
      <div class="flex items-center gap-2 flex-wrap">
        <!-- AI Tools -->
        <div class="bg-zinc-950/50 p-1 rounded-xl border border-white/5 flex gap-1 items-center">
          <button @click="aiGenerate" :disabled="!!aiLoading" class="btn-ai-sm">
            <span>🔮</span> {{ aiLoading === 'all' ? '生成中…' : 'AI生成整卡' }}
          </button>
          <button @click="beautifyModal = true" class="btn-ai-sm">
            <span>🎨</span> 美化
          </button>
        </div>

        <!-- Translation -->
        <div class="bg-zinc-950/50 p-1 rounded-xl border border-white/5 flex gap-1 items-center">
          <button @click="translate('zh')" :disabled="translateLoading" class="btn-xs-action">译中</button>
          <button @click="translate('en')" :disabled="translateLoading" class="btn-xs-action">译英</button>
          <button v-if="translateSnapshot" @click="undoTranslate" class="btn-xs-action text-yellow-400">撤销</button>
        </div>

        <!-- Export formats -->
        <div class="bg-zinc-950/50 p-1 rounded-xl border border-white/5 flex gap-1 items-center">
          <button @click="exportCardAsJson(char)" class="btn-xs-action font-mono">JSON</button>
          <button @click="exportCardAsPng(char)" class="btn-xs-action font-mono">PNG</button>
          <button @click="exportLorebook(char)" class="btn-xs-action font-mono">Book</button>
        </div>

        <!-- Save Button -->
        <button @click="save" :disabled="saving" class="btn-primary py-2 px-5 text-xs font-extrabold shadow-lg shadow-purple-500/20">
          {{ saving ? '保存中…' : '💾 保存角色' }}
        </button>
      </div>
    </header>

    <!-- Main Workspace -->
    <div class="flex flex-1 overflow-hidden flex-col md:flex-row">
      <!-- Left Sidebar (Avatar, Actions & Vertical Tabs) -->
      <aside class="w-full md:w-56 shrink-0 p-5 flex flex-col gap-5 border-r border-white/5 bg-zinc-950/20 overflow-y-auto">
        <!-- Avatar card -->
        <div class="glass-card p-4 rounded-2xl flex flex-col items-center gap-3">
          <label class="cursor-pointer group relative block w-28 h-28 rounded-2xl overflow-hidden border border-white/10 shadow-lg shadow-black/30">
            <img v-if="char.avatar" :src="char.avatar" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
            <div v-else class="w-full h-full flex items-center justify-center bg-zinc-900/50 text-4xl">🎭</div>
            <input type="file" accept="image/*" class="hidden" @change="onAvatarChange" />
            <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[10px] text-white font-bold backdrop-blur-[1px]">更换头像</div>
          </label>
          <span class="text-[10px] text-[var(--text-muted)] text-center font-medium">点击图片上传头像</span>
          
          <div class="w-full flex flex-col gap-2 mt-2">
            <button @click="generateNames" class="btn-action-outline w-full py-2 text-xs font-semibold rounded-xl">🎲 随机起名</button>
            <button @click="router.push(`/agent/${char.id || ''}`)" class="btn-action-outline w-full py-2 text-xs font-semibold rounded-xl">🤖 召唤助手</button>
          </div>
        </div>

        <!-- Sidebar Navigation (Desktop vertical tabs, mobile hides this and uses top tabs) -->
        <nav class="hidden md:flex flex-col gap-1.5">
          <span class="text-[10px] font-bold text-zinc-500 px-3 uppercase tracking-wider mb-1">编辑器菜单</span>
          <button v-for="(label, key) in { basic:'📝 基础信息', dialogue:'💬 对话设定', greetings:'👋 问候用语', meta:'🏷️ 元数信息', worldbook:'🔮 世界设定', regex:'⚙️ 正则脚本' }"
            :key="key" @click="activeTab = key as typeof activeTab"
            class="tab-vertical" :class="{ active: activeTab === key }">
            {{ label }}
          </button>
        </nav>
      </aside>

      <!-- Main Form Area -->
      <main class="flex-1 overflow-y-auto flex flex-col">
        <!-- Mobile Horizontal Tab Bar -->
        <div class="md:hidden flex gap-1 p-2 border-b border-white/5 sticky top-0 bg-[var(--bg)]/95 backdrop-blur-md z-10 overflow-x-auto select-none shrink-0">
          <button v-for="(label, key) in { basic:'📝 基础', dialogue:'💬 对话', greetings:'👋 问候', meta:'🏷️ 元数据', worldbook:'🔮 世界书', regex:'⚙️ 正则' }"
            :key="key" @click="activeTab = key as typeof activeTab"
            class="tab-capsule" :class="{ active: activeTab === key }">
            {{ label }}
          </button>
        </div>

        <!-- Form Fields Grid -->
        <div class="p-6 md:p-8 flex flex-col gap-6 max-w-4xl w-full mx-auto pb-20">
          <!-- Basic Tab -->
          <template v-if="activeTab === 'basic'">
            <div class="field">
              <label>角色名 <span class="text-rose-500">*</span></label>
              <input v-model="d.name" class="input" placeholder="输入角色名称..." />
            </div>
            
            <div class="field">
              <div class="flex justify-between items-center">
                <label>角色描述 (Description)</label>
                <button @click="aiField('description','描述')" :disabled="!!aiLoading" class="ai-field-btn">
                  <span>{{ aiLoading === 'description' ? '生成中…' : '✨ AI 补全' }}</span>
                </button>
              </div>
              <textarea v-model="d.description" class="input resize-y" rows="8" placeholder="描述角色的外貌、穿着、性格特征、背景故事、个人偏好..." />
            </div>

            <div class="field">
              <div class="flex justify-between items-center">
                <label>性格特点 (Personality)</label>
                <button @click="aiField('personality','性格')" :disabled="!!aiLoading" class="ai-field-btn">
                  <span>{{ aiLoading === 'personality' ? '生成中…' : '✨ AI 补全' }}</span>
                </button>
              </div>
              <textarea v-model="d.personality" class="input resize-y" rows="4" placeholder="例如：傲娇、口嫌体正直、忠诚、幽默风趣..." />
            </div>

            <div class="field">
              <div class="flex justify-between items-center">
                <label>剧情背景与场景 (Scenario)</label>
                <button @click="aiField('scenario','场景')" :disabled="!!aiLoading" class="ai-field-btn">
                  <span>{{ aiLoading === 'scenario' ? '生成中…' : '✨ AI 补全' }}</span>
                </button>
              </div>
              <textarea v-model="d.scenario" class="input resize-y" rows="4" placeholder="设定对话发生的时间、地点、当前局势、双方关系等背景信息..." />
            </div>
          </template>

          <!-- Dialogue Tab -->
          <template v-if="activeTab === 'dialogue'">
            <div class="field">
              <div class="flex justify-between items-center">
                <label>首条消息 (First Message)</label>
                <button @click="aiField('first_mes','首条消息')" :disabled="!!aiLoading" class="ai-field-btn">
                  <span>{{ aiLoading === 'first_mes' ? '生成中…' : '✨ AI 补全' }}</span>
                </button>
              </div>
              <textarea v-model="d.first_mes" class="input resize-y" rows="8" placeholder="角色进入聊天时说出的第一句话，用于奠定对话基调..." />
            </div>

            <div class="field">
              <div class="flex justify-between items-center">
                <label>对话示例 (Dialogue Examples)</label>
                <button @click="aiField('mes_example','对话示例')" :disabled="!!aiLoading" class="ai-field-btn">
                  <span>{{ aiLoading === 'mes_example' ? '生成中…' : '✨ AI 补全' }}</span>
                </button>
              </div>
              <textarea v-model="d.mes_example" class="input resize-y font-mono text-xs" rows="8" placeholder="<START>&#10;{{user}}: 你好！&#10;{{char}}: 哼，你终于来了，我等你好久了！" />
            </div>

            <div class="field">
              <div class="flex justify-between items-center">
                <label>系统提示词 (System Prompt)</label>
                <button @click="aiField('system_prompt','系统提示词')" :disabled="!!aiLoading" class="ai-field-btn">
                  <span>{{ aiLoading === 'system_prompt' ? '生成中…' : '✨ AI 补全' }}</span>
                </button>
              </div>
              <textarea v-model="d.system_prompt" class="input resize-y font-mono text-xs" rows="5" placeholder="发给模型的全局系统设定，强制要求扮演该角色..." />
            </div>

            <div class="field">
              <label>后置指令 (Post-History Instructions)</label>
              <textarea v-model="d.post_history_instructions" class="input resize-y font-mono text-xs" rows="4" placeholder="在上下文对话历史末尾追加的系统提醒..." />
            </div>
          </template>

          <!-- Greetings Tab -->
          <template v-if="activeTab === 'greetings'">
            <div class="flex justify-between items-center mb-2">
              <span class="text-xs font-semibold text-[var(--text-muted)]">配置多开场白（共 {{ (d.alternate_greetings?.length ?? 0) + 1 }} 条）</span>
              <button @click="d.alternate_greetings = [...(d.alternate_greetings ?? []), '']" class="btn-sm font-bold text-xs py-1.5 px-3 rounded-lg">+ 新增开场白</button>
            </div>
            
            <div class="flex flex-col gap-4">
              <div class="field glass-card p-4 rounded-2xl">
                <label class="text-[10px] text-purple-400 font-bold uppercase tracking-wider mb-2">默认首条消息 (必填)</label>
                <textarea v-model="d.first_mes" class="input resize-y" rows="5" placeholder="角色的主要开场白..." />
              </div>
              
              <div v-for="(_, i) in (d.alternate_greetings ?? [])" :key="i" class="field glass-card p-4 rounded-2xl animate-fade-in">
                <div class="flex justify-between items-center mb-2">
                  <label class="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">备用开场白 #{{ i + 1 }}</label>
                  <button @click="d.alternate_greetings!.splice(i, 1)" class="text-red-400 hover:text-red-300 text-xs font-semibold">✕ 删除</button>
                </div>
                <textarea v-model="d.alternate_greetings![i]" class="input resize-y" rows="4" placeholder="输入备用开场白内容..." />
              </div>
            </div>
          </template>

          <!-- Meta Tab -->
          <template v-if="activeTab === 'meta'">
            <div class="field">
              <label>分类标签</label>
              <div class="flex flex-wrap gap-1.5 mb-2">
                <span v-for="t in char.tags" :key="t" class="tag-badge">
                  <span>{{ t }}</span>
                  <button @click="removeTag(t)" class="hover:text-red-400 text-xs font-bold shrink-0">×</button>
                </span>
                <span v-if="!char.tags.length" class="text-xs text-[var(--text-muted)] italic">暂无标签</span>
              </div>
              <div class="flex gap-2">
                <input v-model="tagInput" @keydown.enter.prevent="addTag" class="input flex-1" placeholder="输入标签，按回车添加..." />
                <button @click="addTag" class="btn-secondary py-2.5 text-xs font-bold px-4 rounded-xl">添加</button>
              </div>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="field"><label>作者 (Creator)</label><input v-model="d.creator" class="input" placeholder="输入作者署名" /></div>
              <div class="field"><label>角色版本 (Version)</label><input v-model="d.character_version" class="input" placeholder="如 1.0.0" /></div>
            </div>
            
            <div class="field">
              <label>创作者备注 (Creator Notes)</label>
              <textarea v-model="d.creator_notes" class="input resize-y" rows="4" placeholder="关于该角色的开发说明、推荐设置或其他备注信息..." />
            </div>
          </template>

          <!-- Worldbook Tab -->
          <template v-if="activeTab === 'worldbook'">
            <div class="flex justify-between items-center mb-3">
              <span class="text-xs font-semibold text-[var(--text-muted)]">专属世界设定书（共 {{ d.character_book?.entries?.length ?? 0 }} 条）</span>
              <div class="flex gap-2">
                <button @click="aiGenWorldbook" :disabled="!!aiLoading" class="btn-ai-sm text-xs py-1.5 px-3 rounded-lg">
                  <span>🔮</span> AI 批量生成设定
                </button>
                <button @click="addWbEntry" class="btn-sm font-bold text-xs py-1.5 px-3 rounded-lg">+ 新增条目</button>
              </div>
            </div>

            <div v-if="!d.character_book?.entries?.length" class="text-center text-[var(--text-muted)] py-12 glass-card rounded-2xl border border-dashed border-white/5">
              <span class="text-2xl block mb-2">🔮</span>
              <p class="text-xs font-medium">暂无世界设定条目，点击上方按钮新增或由 AI 自动生成</p>
            </div>

            <div class="flex flex-col gap-4">
              <div v-for="entry in d.character_book?.entries ?? []" :key="entry.id"
                class="glass-card p-4 rounded-2xl flex flex-col gap-3 border border-white/5 hover:border-purple-500/20 transition-all animate-fade-in">
                <div class="flex flex-wrap gap-2.5 items-center justify-between">
                  <div class="flex items-center gap-2 flex-1 min-w-[200px]">
                    <div class="relative flex-1">
                      <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-purple-400 font-bold">KEY</span>
                      <input :value="wbKeys(entry)" @input="updateWbKeys(entry, ($event.target as HTMLInputElement).value)"
                        class="input input-key py-1.5 text-xs font-semibold" placeholder="触发关键词 (英文逗号分隔)..." />
                    </div>
                    <input v-model="entry.comment" class="input py-1.5 w-32 text-xs font-semibold" placeholder="条目注释/名称" />
                  </div>
                  
                  <div class="flex items-center gap-3 shrink-0">
                    <label class="flex items-center gap-1.5 text-xs cursor-pointer font-bold uppercase tracking-wider text-[var(--text-muted)] select-none">
                      <input type="checkbox" v-model="entry.enabled" class="accent-[var(--primary)] w-4 h-4" />
                      <span>启用</span>
                    </label>
                    <button @click="removeWbEntry(entry.id)" class="text-red-400 hover:text-red-300 text-sm p-1 hover:bg-white/5 rounded-lg transition-colors">
                      ✕
                    </button>
                  </div>
                </div>
                <textarea v-model="entry.content" class="input resize-y text-xs" rows="3" placeholder="当对话匹配触发词时插入的世界设定内容..." />
              </div>
            </div>
          </template>

          <!-- Regex Tab -->
          <template v-if="activeTab === 'regex'">
            <div class="flex justify-between items-center mb-3">
              <span class="text-xs font-semibold text-[var(--text-muted)]">正则替换处理脚本（共 {{ d.regex_scripts?.length ?? 0 }} 个）</span>
              <button @click="d.regex_scripts = [...(d.regex_scripts ?? []), { id: newUUID(), scriptName: '', findRegex: '', replaceString: '', enabled: true }]"
                class="btn-sm font-bold text-xs py-1.5 px-3 rounded-lg">+ 新增脚本</button>
            </div>

            <div v-if="!d.regex_scripts?.length" class="text-center text-[var(--text-muted)] py-12 glass-card rounded-2xl border border-dashed border-white/5">
              <span class="text-2xl block mb-2">⚙️</span>
              <p class="text-xs font-medium">暂无正则替换脚本，点击右上方按钮添加</p>
            </div>

            <div class="flex flex-col gap-4">
              <div v-for="(rs, i) in (d.regex_scripts ?? [])" :key="rs.id"
                class="glass-card p-4 rounded-2xl flex flex-col gap-3 border border-white/5 hover:border-purple-500/20 transition-all animate-fade-in">
                <div class="flex items-center justify-between gap-3">
                  <input v-model="rs.scriptName" class="input py-1.5 text-xs font-bold text-zinc-100 flex-1" placeholder="替换脚本名称..." />
                  
                  <div class="flex items-center gap-3 shrink-0">
                    <label class="flex items-center gap-1.5 text-xs cursor-pointer font-bold uppercase tracking-wider text-[var(--text-muted)] select-none">
                      <input type="checkbox" v-model="rs.enabled" class="accent-[var(--primary)] w-4 h-4" />
                      <span>启用</span>
                    </label>
                    <button @click="d.regex_scripts!.splice(i, 1)" class="text-red-400 hover:text-red-300 text-sm p-1 hover:bg-white/5 rounded-lg transition-colors">
                      ✕
                    </button>
                  </div>
                </div>
                
                <div class="grid grid-cols-1 gap-2">
                  <div class="relative">
                    <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-purple-400 font-bold font-mono">MATCH</span>
                    <input v-model="rs.findRegex" class="input input-match py-1.5 text-xs font-mono" placeholder="匹配正则表达式 (如 /\\*(.*?)\\*/g)..." />
                  </div>
                  
                  <div class="relative flex flex-col gap-1.5">
                    <label class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">替换内容 (Replace String)</label>
                    <textarea v-model="rs.replaceString" class="input font-mono text-xs resize-y" rows="3" placeholder="替换文本，支持 $1, $2 占位符..." />
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </main>
    </div>

    <!-- Name selection modal -->
    <div v-if="nameModal" class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-md animate-fade-in">
      <div class="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4 shadow-2xl animate-slide-up">
        <div class="flex justify-between items-center border-b border-white/5 pb-2">
          <h3 class="font-extrabold text-sm text-white tracking-wide">🎲 骰子起名</h3>
          <button @click="nameModal = false" class="text-[var(--text-muted)] hover:text-white text-sm">✕</button>
        </div>
        
        <div v-if="nameLoading" class="text-center text-[var(--text-muted)] py-8 flex flex-col items-center justify-center gap-2">
          <div class="inline-block w-6 h-6 border-2 border-t-purple-500 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"></div>
          <span class="text-xs font-medium">灵感涌现中...</span>
        </div>
        
        <div v-else class="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
          <button v-for="name in nameList" :key="name" @click="selectName(name)"
            class="text-left px-4 py-2.5 rounded-xl bg-zinc-950/60 border border-white/5 hover:bg-gradient-to-r hover:from-purple-500/20 hover:to-pink-500/20 hover:border-purple-500/30 text-sm font-semibold transition-all">
            {{ name }}
          </button>
        </div>
        
        <div class="flex gap-2 border-t border-white/5 pt-3">
          <button @click="generateNames" :disabled="nameLoading" class="btn-primary flex-1 text-xs py-2 shadow-md shadow-purple-500/10">
            🎲 重新掷骰
          </button>
          <button @click="nameModal = false" class="btn-secondary flex-1 text-xs py-2">取消</button>
        </div>
      </div>
    </div>

    <!-- AI 前端美化 modal -->
    <div v-if="beautifyModal" class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-md animate-fade-in">
      <div class="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-2xl flex flex-col gap-4 max-h-[90vh] shadow-2xl animate-slide-up">
        <div class="flex justify-between items-center border-b border-white/5 pb-2 shrink-0">
          <h3 class="font-extrabold text-sm text-white tracking-wide">🎨 AI 前端气泡美化 (Inject Custom CSS)</h3>
          <button @click="beautifyModal = false" class="text-[var(--text-muted)] hover:text-white text-sm">✕</button>
        </div>
        
        <div class="flex gap-3 flex-wrap shrink-0">
          <div class="flex flex-col gap-1.5 flex-1 min-w-32">
            <label class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">生成样式方案数</label>
            <select v-model="beautifyCount" class="input text-xs">
              <option :value="3">3套方案</option>
              <option :value="5">5套方案</option>
              <option :value="8">8套方案</option>
            </select>
          </div>
          
          <div class="flex flex-col gap-1.5 flex-1 min-w-32">
            <label class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">CSS 行数限制</label>
            <select v-model="beautifyLines" class="input text-xs">
              <option :value="50">最长 50 行</option>
              <option :value="80">最长 80 行</option>
              <option :value="100">最长 100 行</option>
              <option :value="0">不作限制</option>
            </select>
          </div>
        </div>

        <div class="flex flex-col gap-1.5 shrink-0">
          <label class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">设计细节要求 (Prompt)</label>
          <input v-model="beautifyReq" class="input text-xs" placeholder="例如：赛博朋克深红霓虹风格、极简玻璃拟态、马卡龙可爱气泡..." />
        </div>
        
        <button @click="runBeautify" :disabled="beautifyLoading" class="btn-primary text-xs py-2.5 shrink-0 shadow-lg shadow-purple-500/10">
          <span v-if="beautifyLoading" class="inline-block animate-spin mr-1">⏳</span>
          <span>🔮 开始 AI 艺术创作</span>
        </button>
        
        <!-- Results -->
        <div v-if="beautifyStyles.length" class="flex flex-col gap-3 overflow-y-auto flex-1 pr-1">
          <div v-for="(style, i) in beautifyStyles" :key="i"
            class="bg-zinc-950/60 border border-white/5 rounded-xl overflow-hidden flex flex-col">
            <div class="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-zinc-900/30">
              <span class="text-xs font-bold text-purple-300">艺术方案 #{{ i + 1 }}</span>
              <div class="flex gap-2">
                <button @click="beautifyPreviewIdx = beautifyPreviewIdx === i ? null : i"
                  class="text-xs text-[var(--primary)] font-semibold hover:underline cursor-pointer">
                  {{ beautifyPreviewIdx === i ? '收起预览' : '点击预览' }}
                </button>
                <button @click="injectBeautifyStyle(style)"
                  class="text-xs bg-purple-600 hover:bg-purple-700 text-white px-2.5 py-1 rounded-lg font-bold transition-all shadow shadow-purple-600/15">
                  注入卡片
                </button>
              </div>
            </div>
            
            <iframe v-if="beautifyPreviewIdx === i" :srcdoc="style" class="w-full h-64 bg-zinc-950" sandbox="" />
            <pre v-else class="p-3.5 text-[10px] font-mono text-[var(--text-muted)] overflow-x-auto max-h-32 bg-black/30">{{ style.slice(0, 300) }}{{ style.length > 300 ? '...' : '' }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";

/* Custom Editor Styling */
.btn-primary { 
  @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer; 
}
.btn-ai-sm { 
  @apply bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 hover:border-purple-500/40 text-[var(--primary)] hover:text-purple-300 px-3.5 py-1.5 rounded-xl font-bold transition-all disabled:opacity-50 cursor-pointer text-xs flex items-center gap-1; 
}
.btn-secondary {
  @apply bg-zinc-900/60 hover:bg-zinc-800/80 text-[var(--text)] px-3 py-2 rounded-xl border border-white/5 hover:border-white/10 transition-all cursor-pointer font-bold;
}
.btn-xs-action {
  @apply hover:bg-white/10 text-zinc-300 hover:text-white px-2 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer;
}
.btn-sm { 
  @apply bg-zinc-900/60 hover:bg-zinc-800/80 text-[var(--text)] px-3 py-2 rounded-xl border border-white/5 hover:border-white/10 transition-all cursor-pointer; 
}
.btn-action-outline {
  @apply border border-white/5 hover:border-purple-500/30 text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-purple-500/5 transition-all cursor-pointer;
}
.ai-field-btn { 
  @apply text-xs bg-purple-500/10 border border-purple-500/20 hover:border-purple-500/40 text-[var(--primary)] hover:bg-purple-500/20 hover:text-purple-300 transition-all px-3 py-1 rounded-xl disabled:opacity-40 cursor-pointer font-bold shadow-sm; 
}
.input { 
  @apply w-full bg-zinc-950/40 border border-white/5 text-[var(--text)] px-4 py-3 rounded-2xl outline-none focus:border-[var(--primary)] transition-all focus:bg-zinc-900/75 focus:shadow-[0_0_15px_rgba(168,85,247,0.15)] text-xs md:text-sm; 
}
.input-key {
  padding-left: 2.5rem !important;
}
.input-match {
  padding-left: 3.5rem !important;
}
.field { @apply flex flex-col gap-2; }
.field label { @apply text-xs text-zinc-400 font-bold uppercase tracking-wider select-none; }

/* Desktop Tab Styling */
.tab-vertical {
  @apply text-left px-4 py-2.5 text-xs font-bold text-zinc-400 border-l-2 border-transparent hover:text-white hover:bg-white/5 transition-all rounded-r-xl cursor-pointer flex items-center gap-2;
}
.tab-vertical.active {
  @apply text-[var(--primary)] border-[var(--primary)] bg-purple-500/10;
}

/* Mobile Tab Capsule */
.tab-capsule { 
  @apply px-4 py-2 text-xs font-bold text-zinc-400 border border-white/5 hover:text-white transition-all rounded-xl hover:bg-white/5 cursor-pointer whitespace-nowrap shrink-0; 
}
.tab-capsule.active { 
  @apply text-[var(--primary)] bg-purple-500/10 border-purple-500/20 shadow-sm shadow-purple-500/5; 
}

.tag-badge { @apply text-xs bg-zinc-950/60 text-zinc-100 px-3 py-1 rounded-xl border border-white/5 flex items-center gap-2 shadow-sm font-semibold; }
</style>

