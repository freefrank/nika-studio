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
    <!-- Toolbar -->
    <div class="flex items-center gap-2 px-4 py-3 bg-[var(--bg-2)]/80 backdrop-blur-md border-b border-white/5 sticky top-0 z-20 flex-wrap">
      <button @click="router.back()" class="btn-icon">←</button>
      <span class="font-bold text-sm md:text-base flex-1 truncate min-w-0 tracking-wide">{{ d.name || '新角色' }}</span>
      <button @click="aiGenerate" :disabled="!!aiLoading" class="btn-ai text-xs">{{ aiLoading === 'all' ? '生成中…' : '🔮 AI一键生成' }}</button>
      <button @click="translate('zh')" :disabled="translateLoading" class="btn-sm text-xs">{{ translateLoading ? '…' : '🌐 译中' }}</button>
      <button @click="translate('en')" :disabled="translateLoading" class="btn-sm text-xs">🌐 →EN</button>
      <button v-if="translateSnapshot" @click="undoTranslate" class="btn-sm text-xs text-yellow-400">↩ 撤销</button>
      <button @click="exportCardAsJson(char)" class="btn-sm text-xs">JSON</button>
      <button @click="exportCardAsPng(char)" class="btn-sm text-xs">PNG</button>
      <button @click="exportLorebook(char)" class="btn-sm text-xs">Lorebook</button>
      <button @click="beautifyModal = true" class="btn-ai text-xs">🎨 美化</button>
      <button @click="save" :disabled="saving" class="btn-primary py-2 px-5 text-sm font-bold">{{ saving ? '…' : '保存' }}</button>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <!-- Avatar column -->
      <div class="w-44 shrink-0 p-4 flex flex-col items-center gap-3 border-r border-white/5 bg-zinc-950/20">
        <label class="cursor-pointer group relative">
          <img v-if="char.avatar" :src="char.avatar" class="w-32 h-32 rounded-2xl object-cover border border-white/10 shadow-lg shadow-black/30 group-hover:scale-[1.02] transition-transform duration-300" />
          <div v-else class="w-32 h-32 rounded-2xl bg-zinc-900/60 border border-white/5 flex items-center justify-center text-4xl shadow-inner group-hover:bg-zinc-800 transition-colors duration-300">🎭</div>
          <input type="file" accept="image/*" class="hidden" @change="onAvatarChange" />
          <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl flex items-center justify-center text-xs text-white font-semibold backdrop-blur-[1px]">更换头像</div>
        </label>
        <p class="text-[10px] text-[var(--text-muted)] text-center">点击图片可更换头像</p>
        <button @click="generateNames" class="btn-sm text-xs w-full py-2 rounded-xl">🎲 生成名字</button>
        <button @click="router.push(`/agent/${char.id || ''}`)" class="btn-sm text-xs w-full py-2 rounded-xl">🤖 AI助手</button>
      </div>

      <!-- Main content -->
      <div class="flex-1 overflow-y-auto">
        <div class="flex gap-1 p-1.5 border-b border-white/5 sticky top-0 bg-[var(--bg)]/90 backdrop-blur-md z-10 overflow-x-auto">
          <button v-for="(label, key) in { basic:'基础', dialogue:'对话', greetings:'问候语', meta:'元数据', worldbook:'世界书', regex:'正则' }"
            :key="key" @click="activeTab = key as typeof activeTab"
            class="tab" :class="{ active: activeTab === key }">{{ label }}</button>
        </div>

        <div class="p-5 flex flex-col gap-5 max-w-4xl">
          <!-- Basic -->
          <template v-if="activeTab === 'basic'">
            <div class="field">
              <div class="flex justify-between items-center"><label>角色名</label></div>
              <input v-model="d.name" class="input" placeholder="角色名称" />
            </div>
            <div class="field">
              <div class="flex justify-between items-center">
                <label>描述</label>
                <button @click="aiField('description','描述')" :disabled="!!aiLoading" class="ai-btn">{{ aiLoading==='description'?'…':'✨' }}</button>
              </div>
              <textarea v-model="d.description" class="input resize-y" rows="8" placeholder="角色描述、外貌、背景..." />
            </div>
            <div class="field">
              <div class="flex justify-between items-center">
                <label>性格</label>
                <button @click="aiField('personality','性格')" :disabled="!!aiLoading" class="ai-btn">{{ aiLoading==='personality'?'…':'✨' }}</button>
              </div>
              <textarea v-model="d.personality" class="input resize-y" rows="4" placeholder="性格特点..." />
            </div>
            <div class="field">
              <div class="flex justify-between items-center">
                <label>场景</label>
                <button @click="aiField('scenario','场景')" :disabled="!!aiLoading" class="ai-btn">{{ aiLoading==='scenario'?'…':'✨' }}</button>
              </div>
              <textarea v-model="d.scenario" class="input resize-y" rows="4" placeholder="故事背景场景..." />
            </div>
          </template>

          <!-- Dialogue -->
          <template v-if="activeTab === 'dialogue'">
            <div class="field">
              <div class="flex justify-between items-center">
                <label>首条消息</label>
                <button @click="aiField('first_mes','首条消息')" :disabled="!!aiLoading" class="ai-btn">{{ aiLoading==='first_mes'?'…':'✨' }}</button>
              </div>
              <textarea v-model="d.first_mes" class="input resize-y" rows="8" placeholder="角色的第一条消息..." />
            </div>
            <div class="field">
              <div class="flex justify-between items-center">
                <label>对话示例</label>
                <button @click="aiField('mes_example','对话示例')" :disabled="!!aiLoading" class="ai-btn">{{ aiLoading==='mes_example'?'…':'✨' }}</button>
              </div>
              <textarea v-model="d.mes_example" class="input resize-y" rows="6" placeholder="<START>&#10;{{user}}: ...&#10;{{char}}: ..." />
            </div>
            <div class="field">
              <div class="flex justify-between items-center">
                <label>系统提示词</label>
                <button @click="aiField('system_prompt','系统提示词')" :disabled="!!aiLoading" class="ai-btn">{{ aiLoading==='system_prompt'?'…':'✨' }}</button>
              </div>
              <textarea v-model="d.system_prompt" class="input resize-y" rows="5" placeholder="发给AI的系统指令..." />
            </div>
            <div class="field">
              <label>后置指令</label>
              <textarea v-model="d.post_history_instructions" class="input resize-y" rows="4" placeholder="在每次对话末尾追加的指令..." />
            </div>
          </template>

          <!-- Greetings -->
          <template v-if="activeTab === 'greetings'">
            <div class="flex justify-between items-center">
              <span class="text-sm text-[var(--text-muted)]">共 {{ (d.alternate_greetings?.length ?? 0) + 1 }} 条问候语（含首条消息）</span>
              <button @click="d.alternate_greetings = [...(d.alternate_greetings ?? []), '']" class="btn-sm text-xs">+ 新增</button>
            </div>
            <div class="field">
              <label>首条消息（必填）</label>
              <textarea v-model="d.first_mes" class="input resize-y" rows="5" placeholder="角色进入对话时的第一条消息..." />
            </div>
            <div v-for="(_, i) in (d.alternate_greetings ?? [])" :key="i" class="bg-[var(--bg-2)] border border-[var(--border)] rounded-lg p-3 flex flex-col gap-2">
              <div class="flex justify-between items-center">
                <span class="text-xs text-[var(--text-muted)]">备用问候语 {{ i + 1 }}</span>
                <button @click="d.alternate_greetings!.splice(i, 1)" class="text-red-400 hover:text-red-300 text-xs">删除</button>
              </div>
              <textarea v-model="d.alternate_greetings![i]" class="input resize-y text-sm" rows="4" placeholder="备用开场白..." />
            </div>
          </template>

          <!-- Meta -->
          <template v-if="activeTab === 'meta'">
            <div class="field">
              <label>标签</label>
              <div class="flex flex-wrap gap-2 mb-2">
                <span v-for="t in char.tags" :key="t" class="tag-badge">{{ t }} <button @click="removeTag(t)" class="ml-1 hover:text-red-400">×</button></span>
              </div>
              <div class="flex gap-2">
                <input v-model="tagInput" @keydown.enter.prevent="addTag" class="input flex-1" placeholder="输入标签，按Enter添加" />
                <button @click="addTag" class="btn-sm">添加</button>
              </div>
            </div>
            <div class="field"><label>创作者</label><input v-model="d.creator" class="input" /></div>
            <div class="field"><label>版本</label><input v-model="d.character_version" class="input" /></div>
            <div class="field"><label>备注</label><textarea v-model="d.creator_notes" class="input resize-y" rows="4" /></div>
          </template>

          <!-- Worldbook -->
          <template v-if="activeTab === 'worldbook'">
            <div class="flex justify-between items-center">
              <span class="text-sm text-[var(--text-muted)]">共 {{ d.character_book?.entries?.length ?? 0 }} 条</span>
              <div class="flex gap-2">
                <button @click="aiGenWorldbook" :disabled="!!aiLoading" class="btn-ai text-xs">{{ aiLoading==='worldbook'?'生成中…':'🔮 AI生成' }}</button>
                <button @click="addWbEntry" class="btn-sm text-xs">+ 新增</button>
              </div>
            </div>
            <div v-if="!d.character_book?.entries?.length" class="text-center text-[var(--text-muted)] py-8">暂无条目</div>
            <div v-for="entry in d.character_book?.entries ?? []" :key="entry.id"
              class="bg-[var(--bg-2)] border border-[var(--border)] rounded-lg p-3 flex flex-col gap-2">
              <div class="flex gap-2 items-center">
                <input :value="wbKeys(entry)" @input="updateWbKeys(entry, ($event.target as HTMLInputElement).value)"
                  class="input flex-1 text-sm" placeholder="关键词（逗号分隔）" />
                <input v-model="entry.comment" class="input w-32 text-sm" placeholder="名称" />
                <label class="flex items-center gap-1 text-xs cursor-pointer whitespace-nowrap">
                  <input type="checkbox" v-model="entry.enabled" class="accent-[var(--primary)]" />启用</label>
                <button @click="removeWbEntry(entry.id)" class="text-red-400 hover:text-red-300 text-sm shrink-0">✕</button>
              </div>
              <textarea v-model="entry.content" class="input resize-y text-sm" rows="3" placeholder="条目内容..." />
            </div>
          </template>

          <!-- Regex 正则脚本 -->
          <template v-if="activeTab === 'regex'">
            <div class="flex justify-between items-center">
              <span class="text-sm text-[var(--text-muted)]">共 {{ d.regex_scripts?.length ?? 0 }} 个脚本</span>
              <button @click="d.regex_scripts = [...(d.regex_scripts ?? []), { id: newUUID(), scriptName: '', findRegex: '', replaceString: '', enabled: true }]"
                class="btn-sm text-xs">+ 新增</button>
            </div>
            <div v-if="!d.regex_scripts?.length" class="text-center text-[var(--text-muted)] py-8">暂无正则脚本</div>
            <div v-for="(rs, i) in (d.regex_scripts ?? [])" :key="rs.id"
              class="bg-[var(--bg-2)] border border-[var(--border)] rounded-lg p-3 flex flex-col gap-2">
              <div class="flex gap-2 items-center">
                <input v-model="rs.scriptName" class="input flex-1 text-sm" placeholder="脚本名称" />
                <label class="flex items-center gap-1 text-xs cursor-pointer whitespace-nowrap">
                  <input type="checkbox" v-model="rs.enabled" class="accent-[var(--primary)]" />启用</label>
                <button @click="d.regex_scripts!.splice(i, 1)" class="text-red-400 hover:text-red-300 text-sm shrink-0">✕</button>
              </div>
              <input v-model="rs.findRegex" class="input text-sm font-mono" placeholder="匹配正则（findRegex）" />
              <textarea v-model="rs.replaceString" class="input resize-y text-sm font-mono" rows="4" placeholder="替换内容（replaceString）" />
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Name modal -->
    <div v-if="nameModal" class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div class="bg-[var(--bg-2)] border border-[var(--border)] rounded-xl p-5 w-80 flex flex-col gap-4">
        <div class="flex justify-between items-center">
          <h3 class="font-bold">选择名字</h3>
          <button @click="nameModal = false" class="text-[var(--text-muted)] hover:text-[var(--text)]">✕</button>
        </div>
        <div v-if="nameLoading" class="text-center text-[var(--text-muted)] py-4">生成中…</div>
        <div v-else class="flex flex-col gap-2">
          <button v-for="name in nameList" :key="name" @click="selectName(name)"
            class="text-left px-3 py-2 rounded-lg bg-[var(--bg-3)] hover:bg-[var(--primary)] hover:text-white transition-colors text-sm">
            {{ name }}
          </button>
        </div>
        <div class="flex gap-2">
          <button @click="generateNames" :disabled="nameLoading" class="btn-primary flex-1 text-sm">重新生成</button>
          <button @click="nameModal = false" class="btn-sm text-sm">取消</button>
        </div>
      </div>
    </div>

    <!-- AI 前端美化 modal -->
    <div v-if="beautifyModal" class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div class="bg-[var(--bg-2)] border border-[var(--border)] rounded-xl p-5 w-full max-w-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center shrink-0">
          <h3 class="font-bold">🎨 AI 前端美化</h3>
          <button @click="beautifyModal = false" class="text-[var(--text-muted)] hover:text-[var(--text)]">✕</button>
        </div>
        <div class="flex gap-3 flex-wrap shrink-0">
          <div class="flex flex-col gap-1 flex-1 min-w-32">
            <label class="text-xs text-[var(--text-muted)]">生成数量</label>
            <select v-model="beautifyCount" class="input text-sm">
              <option :value="3">3套</option>
              <option :value="5">5套</option>
              <option :value="8">8套</option>
            </select>
          </div>
          <div class="flex flex-col gap-1 flex-1 min-w-32">
            <label class="text-xs text-[var(--text-muted)]">每套行数上限</label>
            <select v-model="beautifyLines" class="input text-sm">
              <option :value="50">50行</option>
              <option :value="80">80行</option>
              <option :value="100">100行</option>
              <option :value="0">不限制</option>
            </select>
          </div>
        </div>
        <div class="flex flex-col gap-1 shrink-0">
          <label class="text-xs text-[var(--text-muted)]">额外要求（可选）</label>
          <input v-model="beautifyReq" class="input text-sm" placeholder="例如：深色赛博朋克风格、带动画效果..." />
        </div>
        <button @click="runBeautify" :disabled="beautifyLoading" class="btn-primary text-sm shrink-0">
          {{ beautifyLoading ? '生成中…' : '🔮 开始生成' }}
        </button>
        <!-- 生成结果 -->
        <div v-if="beautifyStyles.length" class="flex flex-col gap-3">
          <div v-for="(style, i) in beautifyStyles" :key="i"
            class="bg-[var(--bg-3)] border border-[var(--border)] rounded-lg overflow-hidden">
            <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
              <span class="text-sm font-medium">样式 {{ i + 1 }}</span>
              <div class="flex gap-2">
                <button @click="beautifyPreviewIdx = beautifyPreviewIdx === i ? null : i"
                  class="text-xs text-[var(--primary)] hover:underline">
                  {{ beautifyPreviewIdx === i ? '隐藏预览' : '预览' }}
                </button>
                <button @click="injectBeautifyStyle(style)"
                  class="text-xs bg-[var(--primary)] text-white px-2 py-0.5 rounded hover:bg-[var(--primary-dark)]">注入</button>
              </div>
            </div>
            <iframe v-if="beautifyPreviewIdx === i" :srcdoc="style" class="w-full h-64 bg-white" sandbox="" />
            <pre v-else class="p-3 text-xs overflow-x-auto max-h-32 text-[var(--text-muted)]">{{ style.slice(0, 300) }}{{ style.length > 300 ? '...' : '' }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";
.btn-primary { 
  @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl font-bold transition-all shadow-md shadow-purple-500/10 hover:shadow-purple-500/20 active:scale-95 disabled:opacity-50 cursor-pointer; 
}
.btn-ai { 
  @apply bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 hover:border-purple-500/40 text-[var(--primary)] hover:text-purple-300 px-3.5 py-2 rounded-xl font-semibold transition-all disabled:opacity-50 cursor-pointer; 
}
.btn-sm { 
  @apply bg-zinc-900/50 hover:bg-zinc-800/80 text-[var(--text)] px-3.5 py-2 rounded-xl border border-white/5 hover:border-white/10 transition-all cursor-pointer; 
}
.btn-icon { @apply text-base p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer; }
.ai-btn { 
  @apply text-xs bg-purple-500/10 border border-purple-500/25 hover:border-purple-500/45 text-[var(--primary)] hover:bg-purple-500/20 hover:text-purple-300 transition-all px-2.5 py-1 rounded-lg disabled:opacity-40 cursor-pointer shadow-sm; 
}
.input { 
  @apply w-full bg-zinc-900/50 border border-white/5 text-[var(--text)] px-3.5 py-2.5 rounded-xl outline-none focus:border-[var(--primary)] transition-all focus:bg-zinc-900/85 focus:shadow-[0_0_15px_rgba(168,85,247,0.15)] text-sm; 
}
.field { @apply flex flex-col gap-1.5; }
.field label { @apply text-xs text-[var(--text-muted)] font-semibold uppercase tracking-wider; }
.tab { 
  @apply px-4 py-2 text-xs font-semibold text-[var(--text-muted)] border-b-2 border-transparent hover:text-[var(--text)] transition-all rounded-lg hover:bg-white/5 cursor-pointer; 
}
.tab.active { 
  @apply text-[var(--primary)] bg-purple-500/10 border-b-0 shadow-sm shadow-purple-500/5; 
}
.tag-badge { @apply text-xs bg-zinc-900/50 text-[var(--text)] px-2.5 py-1 rounded-lg border border-white/5 flex items-center gap-1 shadow-sm; }
</style>
