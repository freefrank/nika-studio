<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCharacterStore } from '@/stores/characterStore'
import { agentDB, type AgentMessage } from '@/services/agentService'
import { streamChat } from '@/services/apiService'
import { settingsService } from '@/services/settingsService'
import { historyService } from '@/services/historyService'
import DOMPurify from 'dompurify'
import type { Character } from '@/types'

const route = useRoute()
const router = useRouter()
const charStore = useCharacterStore()

const characterId = route.params.id as string
const messages = ref<AgentMessage[]>([])
const input = ref('')
const streaming = ref(false)
const abortCtrl = ref<AbortController | null>(null)
const messagesEl = ref<HTMLElement | null>(null)
const previewHtml = ref('')
const showPreview = ref(false)

const inputEl = ref<HTMLTextAreaElement | null>(null)

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

const char = computed(() => charStore.characters.find(c => c.id === characterId))

const SET_FIELDS = ['name','description','personality','scenario','first_mes','mes_example','system_prompt','post_history_instructions','creator_notes','character_version'] as const
const PATCH_KEYS = ['set','worldbook_add','worldbook_update','greeting_add','regex_add','regex_update'] as const
const WORLDBOOK_ADD_KEYS = ['keys','comment','content'] as const
const WORLDBOOK_UPDATE_KEYS = ['index','content','keys'] as const
const REGEX_ADD_KEYS = ['scriptName','findRegex','replaceString'] as const
const REGEX_UPDATE_KEYS = ['index','replaceString','findRegex'] as const
const HTML_PREVIEW_MAX_LENGTH = 120_000

type SetField = typeof SET_FIELDS[number]

interface AgentPatch {
  set?: Partial<Record<SetField, string>>
  worldbook_add?: { keys: string[]; comment?: string; content: string }
  worldbook_update?: { index: number; content?: string; keys?: string[] }
  greeting_add?: string
  regex_add?: { scriptName: string; findRegex: string; replaceString: string }
  regex_update?: { index: number; replaceString?: string; findRegex?: string }
}

interface ValidatedPatch {
  patch: AgentPatch
  summary: string[]
}

interface PatchApplyResult {
  note: string
  applied: boolean
}

const SYSTEM_PROMPT = `你是妮卡AI助手，专业的角色卡编辑助手。你帮助用户修改、优化和创作SillyTavern角色卡。

用户会给你当前角色卡的摘要。你可以：
1. 回答关于角色卡的问题
2. 提出修改建议
3. 输出 \`\`\`json:patch 代码块来直接修改角色卡
4. 输出 \`\`\`html 代码块来展示前端效果

json:patch 格式：
\`\`\`json:patch
{
  "set": { "字段名": "新值" },
  "worldbook_add": { "keys": ["触发词"], "comment": "名称", "content": "内容" },
  "worldbook_update": { "index": 0, "content": "新内容", "keys": ["词"] },
  "greeting_add": "新的备用问候语",
  "regex_add": { "scriptName": "名称", "findRegex": "正则", "replaceString": "替换内容" },
  "regex_update": { "index": 0, "replaceString": "新内容" }
}
\`\`\`

可以 set 的字段：name, description, personality, scenario, first_mes, mes_example, system_prompt, post_history_instructions, creator_notes, character_version`

function buildContext(c: Character): string {
  const d = c.cardData.data
  const parts = [
    `## 当前角色卡\n名称: ${d.name || '(未命名)'}`,
    d.description ? `### 描述 (前300字)\n${d.description.slice(0, 300)}` : '',
    d.personality ? `### 个性 (前200字)\n${d.personality.slice(0, 200)}` : '',
    d.system_prompt ? `### 系统提示词 (前300字)\n${d.system_prompt.slice(0, 300)}` : '',
  ]
  const entries = d.character_book?.entries ?? []
  if (entries.length) {
    parts.push(`### 世界书 (${entries.length}条)\n` + entries.map((e, i) => `  [${i}] ${e.comment || '(无名)'} | 触发: ${e.keys.join(', ')}`).join('\n'))
  }
  const regex = d.regex_scripts ?? []
  if (regex.length) {
    parts.push(`### 正则脚本 (${regex.length}个)\n` + regex.map((r, i) => `  [${i}] ${r.scriptName} | 匹配: ${r.findRegex.slice(0,50)}`).join('\n'))
  }
  const greetings = d.alternate_greetings ?? []
  if (greetings.length) parts.push(`### 备用问候语 (${greetings.length}条)`)
  parts.push(`\n## 命令\n/peek field <字段名> | /peek worldbook <索引或名称> | /peek regex <索引> | /list all | /list worldbook | /list fields`)
  return parts.filter(Boolean).join('\n\n')
}

// 处理 /peek /list 命令，返回响应或 null（非命令）
function handleCommand(content: string, c: Character): string | null {
  const d = c.cardData.data
  const t = content.trim()

  if (t.startsWith('/peek field ')) {
    const fn = t.slice(12).trim()
    const val = (d as Record<string, unknown>)[fn]
    if (val === undefined) return `❌ 字段 "${fn}" 不存在。可用字段: name, description, personality, scenario, first_mes, mes_example, system_prompt, post_history_instructions, creator_notes`
    const s = String(val)
    return `**${fn}** (${s.length}字):\n\`\`\`\n${s.slice(0, 3000)}${s.length > 3000 ? '\n...(截断)' : ''}\n\`\`\``
  }

  if (t.startsWith('/peek worldbook ')) {
    const q = t.slice(16).trim()
    const entries = d.character_book?.entries ?? []
    const entry = /^\d+$/.test(q) ? entries[parseInt(q)] : entries.find(e => (e.comment || '').includes(q) || e.keys.some(k => k.includes(q)))
    if (!entry) return `❌ 未找到世界书条目 "${q}"`
    return `**[${entries.indexOf(entry)}] ${entry.comment || '(无名)'}**\n触发词: ${entry.keys.join(', ')}\n\`\`\`\n${entry.content}\n\`\`\``
  }

  if (t.startsWith('/peek regex ')) {
    const q = t.slice(12).trim()
    const scripts = d.regex_scripts ?? []
    const s = /^\d+$/.test(q) ? scripts[parseInt(q)] : scripts.find(r => r.scriptName.includes(q))
    if (!s) return `❌ 未找到正则脚本 "${q}"`
    const lines = s.replaceString.split('\n')
    const numbered = lines.map((l, i) => `${String(i+1).padStart(3)}: ${l}`).join('\n')
    return `**[${scripts.indexOf(s)}] ${s.scriptName}**\n匹配: \`${s.findRegex}\`\n替换内容:\n\`\`\`\n${numbered}\n\`\`\``
  }

  if (t === '/list all' || t === '/list fields') {
    const fields = ['name','description','personality','scenario','first_mes','mes_example','system_prompt','post_history_instructions','creator_notes','character_version'] as const
    const lines = fields.map(f => `  ${f}: ${String((d as Record<string,unknown>)[f] ?? '').length}字`)
    return `**字段列表:**\n${lines.join('\n')}`
  }

  if (t === '/list worldbook') {
    const entries = d.character_book?.entries ?? []
    if (!entries.length) return '世界书为空'
    return `**世界书 (${entries.length}条):**\n` + entries.map((e, i) => `  [${i}] ${e.comment || '(无名)'} | 触发: ${e.keys.join(', ')} | ${e.content.length}字`).join('\n')
  }

  return null // not a command
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function ensureOnlyKeys(obj: Record<string, unknown>, allowed: readonly string[], label: string): string[] {
  const invalid = Object.keys(obj).filter(key => !allowed.includes(key))
  return invalid.length ? [`${label} 包含未允许字段: ${invalid.join(', ')}`] : []
}

function validateSetPatch(value: unknown): { value?: AgentPatch['set']; errors: string[]; summary?: string } {
  if (!isPlainObject(value)) return { errors: ['set 必须是对象'] }
  const errors = ensureOnlyKeys(value, SET_FIELDS, 'set')
  const changedFields: string[] = []
  for (const [key, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue !== 'string') errors.push(`set.${key} 必须是字符串`)
    else changedFields.push(key)
  }
  if (!changedFields.length) errors.push('set 不能为空')
  return {
    value: errors.length ? undefined : value as AgentPatch['set'],
    errors,
    summary: changedFields.length ? `set: ${changedFields.join(', ')}` : undefined,
  }
}

function validateWorldbookAddPatch(value: unknown): { value?: AgentPatch['worldbook_add']; errors: string[]; summary?: string } {
  if (!isPlainObject(value)) return { errors: ['worldbook_add 必须是对象'] }
  const errors = ensureOnlyKeys(value, WORLDBOOK_ADD_KEYS, 'worldbook_add')
  if (!isStringArray(value.keys)) errors.push('worldbook_add.keys 必须是字符串数组')
  if (value.comment !== undefined && typeof value.comment !== 'string') errors.push('worldbook_add.comment 必须是字符串')
  if (typeof value.content !== 'string') errors.push('worldbook_add.content 必须是字符串')
  return {
    value: errors.length ? undefined : { keys: value.keys as string[], comment: value.comment as string | undefined, content: value.content as string },
    errors,
    summary: errors.length ? undefined : `新增世界书: ${(typeof value.comment === 'string' && value.comment) || '(未命名)'} | keys=${(value.keys as string[]).join(', ') || '(空)'}`,
  }
}

function validateWorldbookUpdatePatch(value: unknown, c: Character): { value?: AgentPatch['worldbook_update']; errors: string[]; summary?: string } {
  if (!isPlainObject(value)) return { errors: ['worldbook_update 必须是对象'] }
  const errors = ensureOnlyKeys(value, WORLDBOOK_UPDATE_KEYS, 'worldbook_update')
  if (!Number.isInteger(value.index)) errors.push('worldbook_update.index 必须是整数')
  if (value.content !== undefined && typeof value.content !== 'string') errors.push('worldbook_update.content 必须是字符串')
  if (value.keys !== undefined && !isStringArray(value.keys)) errors.push('worldbook_update.keys 必须是字符串数组')
  const entries = c.cardData.data.character_book?.entries ?? []
  if (Number.isInteger(value.index) && !entries[value.index as number]) errors.push(`worldbook_update.index 超出范围: ${value.index as number}`)
  if (value.content === undefined && value.keys === undefined) errors.push('worldbook_update 至少需要 content 或 keys')
  return {
    value: errors.length ? undefined : { index: value.index as number, content: value.content as string | undefined, keys: value.keys as string[] | undefined },
    errors,
    summary: errors.length ? undefined : `更新世界书[${value.index as number}]`,
  }
}

function validateGreetingAddPatch(value: unknown): { value?: string; errors: string[]; summary?: string } {
  if (typeof value !== 'string') return { errors: ['greeting_add 必须是字符串'] }
  if (!value.trim()) return { errors: ['greeting_add 不能为空'] }
  return { value, errors: [], summary: '新增备用问候语' }
}

function validateRegexAddPatch(value: unknown): { value?: AgentPatch['regex_add']; errors: string[]; summary?: string } {
  if (!isPlainObject(value)) return { errors: ['regex_add 必须是对象'] }
  const errors = ensureOnlyKeys(value, REGEX_ADD_KEYS, 'regex_add')
  if (typeof value.scriptName !== 'string') errors.push('regex_add.scriptName 必须是字符串')
  if (typeof value.findRegex !== 'string') errors.push('regex_add.findRegex 必须是字符串')
  if (typeof value.replaceString !== 'string') errors.push('regex_add.replaceString 必须是字符串')
  return {
    value: errors.length ? undefined : { scriptName: value.scriptName as string, findRegex: value.findRegex as string, replaceString: value.replaceString as string },
    errors,
    summary: errors.length ? undefined : `新增正则脚本: ${value.scriptName as string}`,
  }
}

function validateRegexUpdatePatch(value: unknown, c: Character): { value?: AgentPatch['regex_update']; errors: string[]; summary?: string } {
  if (!isPlainObject(value)) return { errors: ['regex_update 必须是对象'] }
  const errors = ensureOnlyKeys(value, REGEX_UPDATE_KEYS, 'regex_update')
  if (!Number.isInteger(value.index)) errors.push('regex_update.index 必须是整数')
  if (value.replaceString !== undefined && typeof value.replaceString !== 'string') errors.push('regex_update.replaceString 必须是字符串')
  if (value.findRegex !== undefined && typeof value.findRegex !== 'string') errors.push('regex_update.findRegex 必须是字符串')
  const scripts = c.cardData.data.regex_scripts ?? []
  if (Number.isInteger(value.index) && !scripts[value.index as number]) errors.push(`regex_update.index 超出范围: ${value.index as number}`)
  if (value.replaceString === undefined && value.findRegex === undefined) errors.push('regex_update 至少需要 replaceString 或 findRegex')
  return {
    value: errors.length ? undefined : { index: value.index as number, replaceString: value.replaceString as string | undefined, findRegex: value.findRegex as string | undefined },
    errors,
    summary: errors.length ? undefined : `更新正则脚本[${value.index as number}]`,
  }
}

function validatePatch(raw: unknown, c: Character): { validated?: ValidatedPatch; errors: string[] } {
  if (!isPlainObject(raw)) return { errors: ['patch 顶层必须是对象'] }
  const errors = ensureOnlyKeys(raw, PATCH_KEYS, 'patch')
  const patch: AgentPatch = {}
  const summary: string[] = []

  if ('set' in raw) {
    const result = validateSetPatch(raw.set)
    errors.push(...result.errors)
    if (result.value) patch.set = result.value
    if (result.summary) summary.push(result.summary)
  }
  if ('worldbook_add' in raw) {
    const result = validateWorldbookAddPatch(raw.worldbook_add)
    errors.push(...result.errors)
    if (result.value) patch.worldbook_add = result.value
    if (result.summary) summary.push(result.summary)
  }
  if ('worldbook_update' in raw) {
    const result = validateWorldbookUpdatePatch(raw.worldbook_update, c)
    errors.push(...result.errors)
    if (result.value) patch.worldbook_update = result.value
    if (result.summary) summary.push(result.summary)
  }
  if ('greeting_add' in raw) {
    const result = validateGreetingAddPatch(raw.greeting_add)
    errors.push(...result.errors)
    if (result.value) patch.greeting_add = result.value
    if (result.summary) summary.push(result.summary)
  }
  if ('regex_add' in raw) {
    const result = validateRegexAddPatch(raw.regex_add)
    errors.push(...result.errors)
    if (result.value) patch.regex_add = result.value
    if (result.summary) summary.push(result.summary)
  }
  if ('regex_update' in raw) {
    const result = validateRegexUpdatePatch(raw.regex_update, c)
    errors.push(...result.errors)
    if (result.value) patch.regex_update = result.value
    if (result.summary) summary.push(result.summary)
  }

  if (!Object.keys(patch).length) errors.push('patch 未包含任何可执行修改')
  return errors.length ? { errors } : { validated: { patch, summary }, errors: [] }
}

function buildPatchSummary(lines: string[]): string {
  return lines.map((line, index) => `${index + 1}. ${line}`).join('\n')
}

function applyPatch(patch: AgentPatch, c: Character) {
  const d = c.cardData.data
  if (patch.set && typeof patch.set === 'object') {
    for (const [k, v] of Object.entries(patch.set)) {
      if (SET_FIELDS.includes(k as SetField) && typeof v === 'string') {
        (d as Record<string, unknown>)[k] = v
      }
    }
    if (patch.set.name) c.name = patch.set.name
  }
  if (patch.worldbook_add) {
    const wb = d.character_book ??= { name: '', entries: [] }
    wb.entries.push({
      id: crypto.randomUUID(), keys: patch.worldbook_add.keys, content: patch.worldbook_add.content,
      enabled: true, insertion_order: wb.entries.length,
      comment: patch.worldbook_add.comment ?? '', selective: false, secondary_keys: [],
      constant: false, position: 'before_char', parentId: null,
    })
  }
  if (patch.worldbook_update) {
    const entries = d.character_book?.entries ?? []
    if (entries[patch.worldbook_update.index]) {
      if (patch.worldbook_update.content !== undefined) entries[patch.worldbook_update.index].content = patch.worldbook_update.content
      if (patch.worldbook_update.keys) entries[patch.worldbook_update.index].keys = patch.worldbook_update.keys
    }
  }
  if (patch.greeting_add && typeof patch.greeting_add === 'string') {
    d.alternate_greetings ??= []
    d.alternate_greetings.push(patch.greeting_add)
  }
  if (patch.regex_add) {
    d.regex_scripts ??= []
    d.regex_scripts.push({
      id: crypto.randomUUID(),
      scriptName: patch.regex_add.scriptName,
      findRegex: patch.regex_add.findRegex,
      replaceString: patch.regex_add.replaceString,
      enabled: true,
    })
  }
  if (patch.regex_update) {
    const scripts = d.regex_scripts ?? []
    if (scripts[patch.regex_update.index]) {
      if (patch.regex_update.replaceString !== undefined) scripts[patch.regex_update.index].replaceString = patch.regex_update.replaceString
      if (patch.regex_update.findRegex !== undefined) scripts[patch.regex_update.index].findRegex = patch.regex_update.findRegex
    }
  }
}

async function extractAndApplyPatches(content: string, c: Character, messageId: string): Promise<PatchApplyResult> {
  const patchRe = /```json:patch\s*([\s\S]*?)```/g
  let m: RegExpExecArray | null
  const validatedPatches: ValidatedPatch[] = []
  const errors: string[] = []
  let patchIndex = 0

  while ((m = patchRe.exec(content)) !== null) {
    patchIndex += 1
    try {
      const patch = JSON.parse(m[1]) as unknown
      const result = validatePatch(patch, c)
      if (result.validated) validatedPatches.push(result.validated)
      if (result.errors.length) errors.push(...result.errors.map(err => `第 ${patchIndex} 个 patch: ${err}`))
    } catch (error) {
      errors.push(`第 ${patchIndex} 个 patch: JSON 解析失败: ${(error as Error).message}`)
    }
  }

  if (!validatedPatches.length) {
    return {
      note: errors.length ? `\n\n❌ Patch 未执行:\n${errors.map(err => `- ${err}`).join('\n')}` : '',
      applied: false,
    }
  }

  if (errors.length) {
    return { note: `\n\n❌ Patch 未执行:\n${errors.map(err => `- ${err}`).join('\n')}`, applied: false }
  }

  const summaryLines = validatedPatches.flatMap((item, index) => item.summary.map(line => `Patch ${index + 1}: ${line}`))
  const confirmed = window.confirm(`检测到 ${validatedPatches.length} 个 patch，是否应用到角色卡？\n\n${buildPatchSummary(summaryLines)}`)
  if (!confirmed) return { note: `\n\nℹ️ 已取消应用 ${validatedPatches.length} 个 patch。`, applied: false }

  try {
    await historyService.saveAgentPatchSnapshot({
      character: c,
      messageId,
      reason: buildPatchSummary(summaryLines),
    })
  } catch (error) {
    return { note: `\n\n❌ Patch 未执行: 保存修改前快照失败: ${(error as Error).message}`, applied: false }
  }
  for (const item of validatedPatches) applyPatch(item.patch, c)
  return {
    note: `\n\n✅ 已应用 ${validatedPatches.length} 个修改到角色卡\n${summaryLines.map(line => `- ${line}`).join('\n')}`,
    applied: true,
  }
}

function extractHtmlPreview(content: string): string | null {
  const m = content.match(/```html\s*([\s\S]*?)```/)
  if (!m) return null
  return m[1].length > HTML_PREVIEW_MAX_LENGTH ? m[1].slice(0, HTML_PREVIEW_MAX_LENGTH) : m[1]
}

function sanitizePreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'oninput', 'onsubmit'],
  })
}

async function scrollBottom() {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

onMounted(async () => {
  if (!charStore.characters.length) await charStore.load()
  if (!char.value) { router.push('/'); return }
  messages.value = await agentDB.load(characterId)
  await scrollBottom()
})

async function send() {
  if (!input.value.trim() || streaming.value || !char.value) return
  const content = input.value.trim()
  input.value = ''

  messages.value.push({ id: crypto.randomUUID(), role: 'user', content, timestamp: Date.now() })

  // Handle local commands without AI
  const cmdResult = handleCommand(content, char.value)
  if (cmdResult !== null) {
    messages.value.push({ id: crypto.randomUUID(), role: 'assistant', content: cmdResult, timestamp: Date.now() })
    try {
      await agentDB.save(characterId, messages.value)
    } catch (e) {
      messages.value.push({ id: crypto.randomUUID(), role: 'assistant', content: '[保存失败: ' + (e as Error).message + ']', timestamp: Date.now() })
    }
    await scrollBottom()
    return
  }

  const aMsg: AgentMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', timestamp: Date.now() }
  messages.value.push(aMsg)
  streaming.value = true
  abortCtrl.value = new AbortController()
  await scrollBottom()

  try {
    const cfg = settingsService.get().apiConfig
    const ctx = buildContext(char.value)
    const history = messages.value.slice(0, -1).slice(-10).map(m => ({
      role: m.role as 'user' | 'assistant', content: m.content,
    }))
    await streamChat(
      cfg,
      [{ role: 'system', content: SYSTEM_PROMPT + '\n\n' + ctx }, ...history, { role: 'user', content }],
      delta => { aMsg.content += delta; scrollBottom() },
      abortCtrl.value.signal,
    )

    // Apply patches and show preview
    const patchResult = await extractAndApplyPatches(aMsg.content, char.value, aMsg.id)
    if (patchResult.note) {
      aMsg.content += patchResult.note
      if (patchResult.applied) await charStore.save(char.value)
    }
    const html = extractHtmlPreview(aMsg.content)
    if (html) { previewHtml.value = sanitizePreviewHtml(html); showPreview.value = true }

  } catch (e: unknown) {
    if ((e as Error)?.name !== 'AbortError') aMsg.content += '\n[错误: ' + (e as Error).message + ']'
  } finally {
    streaming.value = false
    try {
      await agentDB.save(characterId, messages.value)
    } catch (e) {
      aMsg.content += '\n[保存失败: ' + (e as Error).message + ']'
    }
  }
}

async function clearHistory() {
  if (confirm('清除所有对话记录？')) {
    messages.value = []
    try {
      await agentDB.save(characterId, [])
    } catch (e) {
      alert('清空失败: ' + (e as Error).message)
    }
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
}

function renderContent(content: string) {
  const safeContent = DOMPurify.sanitize(content)
  // Simple: highlight json:patch blocks and html blocks
  return safeContent
    .replace(/```json:patch([\s\S]*?)```/g, '<pre class="patch-block">$1</pre>')
    .replace(/```html([\s\S]*?)```/g, '<pre class="html-block">$1</pre>')
    .replace(/```([\s\S]*?)```/g, '<pre class="code-block">$1</pre>')
    .replace(/\n/g, '<br>')
}
</script>

<template>
  <div class="h-screen flex flex-col bg-[var(--bg)] text-[var(--text)] animate-slide-up">
    <!-- Header -->
    <div class="flex items-center gap-3 px-4 py-3 bg-[var(--bg-2)]/80 backdrop-blur-md border-b border-white/5 shrink-0 z-20">
      <button @click="router.back()" class="text-xl hover:text-[var(--primary)] transition-colors cursor-pointer">←</button>
      <span class="text-lg">🤖</span>
      <span class="font-bold text-sm flex-1 tracking-wide">妮卡 AI 助手 — {{ char?.name ?? '...' }}</span>
      <button @click="showPreview = !showPreview" class="btn-sm text-xs py-1.5 px-3 rounded-lg">{{ showPreview ? '隐藏预览' : '显示预览' }}</button>
      <button @click="clearHistory" class="w-8 h-8 rounded-lg flex items-center justify-center text-sm text-[var(--text-muted)] hover:bg-white/5 hover:text-red-400 transition-all cursor-pointer" title="清空对话">🗑️</button>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <!-- Chat -->
      <div class="flex flex-col flex-1 overflow-hidden">
        <div ref="messagesEl" class="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">
          <div v-if="!messages.length" class="max-w-md mx-auto text-center py-16 px-6 glass-panel rounded-2xl border border-white/5 my-10">
            <div class="w-16 h-16 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-full flex items-center justify-center text-3xl mx-auto mb-4 shadow-lg shadow-purple-500/5">🤖</div>
            <h3 class="text-lg font-semibold mb-2">我是妮卡AI助手</h3>
            <p class="text-sm text-[var(--text-muted)]">我可以帮你修改和优化角色卡。你可以指令我：帮我改进描述、添加世界书条目、生成前端样式...</p>
          </div>
          <template v-for="msg in messages" :key="msg.id">
            <div :class="['flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start']" class="animate-slide-up">
              <div v-if="msg.role === 'assistant'" class="text-xl shrink-0 mt-1">🤖</div>
              <div :class="['bubble relative max-w-[80%] md:max-w-[70%]',
                msg.role === 'user'
                  ? 'bubble-user'
                  : 'bubble-ai']"
                v-html="renderContent(msg.content)" />
            </div>
          </template>
          <div v-if="streaming" class="text-xs text-center text-[var(--text-muted)] animate-pulse">
            <button @click="abortCtrl?.abort()" class="hover:text-red-400 bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded-lg transition-colors cursor-pointer">■ 停止生成</button>
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

      <!-- HTML Preview pane -->
      <div v-if="showPreview" class="w-96 shrink-0 border-l border-white/5 flex flex-col bg-zinc-950/20">
        <div class="px-4 py-3 bg-[var(--bg-2)]/80 backdrop-blur-md border-b border-white/5 text-sm font-semibold tracking-wide shrink-0">HTML 预览</div>
        <iframe :srcdoc="previewHtml" class="flex-1 bg-white" sandbox="" />
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";
.input { @apply w-full bg-zinc-900/50 border border-white/5 text-[var(--text)] px-3 py-2 rounded-lg outline-none focus:border-[var(--primary)] transition-colors text-sm focus:bg-zinc-900/85; }
.btn-primary { @apply bg-[var(--primary)] hover:bg-[var(--primary-dark)] text-white px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-40 cursor-pointer; }
.btn-sm { @apply bg-zinc-900/50 hover:bg-zinc-800/80 text-[var(--text)] px-3 py-1.5 rounded-lg border border-white/5 text-xs transition-colors cursor-pointer; }
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
:deep(.patch-block) { @apply bg-emerald-950/40 border border-emerald-800/30 rounded-xl p-3 text-xs text-emerald-300 overflow-x-auto my-2.5 whitespace-pre shadow-inner font-mono; }
:deep(.html-block) { @apply bg-cyan-950/40 border border-cyan-800/30 rounded-xl p-3 text-xs text-cyan-300 overflow-x-auto my-2.5 whitespace-pre shadow-inner font-mono; }
:deep(.code-block) { @apply bg-zinc-950/80 border border-white/5 rounded-xl p-3 text-xs text-zinc-300 overflow-x-auto my-2.5 whitespace-pre shadow-inner font-mono; }
</style>
