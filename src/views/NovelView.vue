<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { settingsService } from '@/services/settingsService'
import { streamChat } from '@/services/apiService'
import { useCharacterStore } from '@/stores/characterStore'
import type { Character, WorldBook, WorldBookEntry } from '@/types'
import { openDB, tx, cloneForStorage } from '@/services/db'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = withDefaults(defineProps<{ standalone?: boolean }>(), { standalone: true })

const router = useRouter()
const charStore = useCharacterStore()

const fileContent = ref('')
const fileName = ref('')
const encoding = ref('auto')
const fileInputEl = ref<HTMLInputElement | null>(null)
const chapterRegex = ref('第[零一二三四五六七八九十百千\\d]+[章节回幕]')
const chapters = ref<{ title: string; content: string; processed?: boolean; failed?: boolean; error?: string }[]>([])
const worldbook = ref<WorldBook>({ name: '', entries: [] })
const processing = ref(false)
const progress = ref({ current: 0, total: 0 })
const abortCtrl = ref<AbortController | null>(null)
const splitSize = ref(3000)
const incrementalMode = ref(true) // 增量模式：只输出新增/变更条目
const enablePlotOutline = ref(true)
const enableLiteraryStyle = ref(false)
const currentPrompt = ref('')
const currentResponse = ref('')

const localGeneratedWorldbookRef = ref<any>({})
const hasSavedState = ref(false)
const savedStateInfo = ref({ fileName: '', progress: '', percent: 0 })
const STATE_DB = 'NikaNovelStateDB'
const STATE_STORE = 'novel_state'
const showChaptersList = ref(true)

const expandedEntries = ref<Set<string>>(new Set())

function toggleEntry(id: string) {
  if (expandedEntries.value.has(id)) {
    expandedEntries.value.delete(id)
  } else {
    expandedEntries.value.add(id)
  }
  // Force Vue to detect the change by creating a new Set
  expandedEntries.value = new Set(expandedEntries.value)
}

function isExpanded(id: string) {
  return expandedEntries.value.has(id)
}

function isContentLong(content: string) {
  return content.length > 80 || content.includes('\n')
}

function renderMarkdown(content: string) {
  try {
    return DOMPurify.sanitize(marked.parse(content) as string)
  } catch (e) {
    console.error('Failed to parse markdown:', e)
    return content
  }
}

// 自定义分类系统
interface Category {
  name: string
  enabled: boolean
  entryExample: string
  keywordsExample: string[]
  contentGuide: string
}

const DEFAULT_CATEGORIES: Category[] = [
  {
    name: "角色",
    enabled: true,
    entryExample: "角色真实姓名",
    keywordsExample: ["真实姓名", "称呼1", "称呼2", "绰号"],
    contentGuide: "基于原文的角色描述，包含但不限于**名称**:（必须要）、**性别**:、**MBTI(必须要，如变化请说明背景)**:、**貌龄**:、**年龄**:、**身份**:、**背景**:、**性格**:、**外貌**:、**技能**:、**重要事件**:、**话语示例**:、**弱点**:、**背景故事**:等（实际嵌套或者排列方式按合理的逻辑）"
  },
  {
    name: "地点",
    enabled: true,
    entryExample: "地点真实名称",
    keywordsExample: ["地点名", "别称", "俗称"],
    contentGuide: "基于原文的地点描述，包含但不限于**名称**:（必须要）、**位置**:、**特征**:、**重要事件**:等（实际嵌套或者排列方式按合理的逻辑）"
  },
  {
    name: "组织",
    enabled: true,
    entryExample: "组织真实名称",
    keywordsExample: ["组织名", "简称", "代号"],
    contentGuide: "基于原文的组织描述，包含但不限于**名称**:（必须要）、**性质**:、**成员**:、**目标**:等（实际嵌套或者排列方式按合理的逻辑）"
  },
  {
    name: "道具",
    enabled: false,
    entryExample: "道具名称",
    keywordsExample: ["道具名", "别名"],
    contentGuide: "基于原文的道具描述，包含但不限于**名称**:、**类型**:、**功能**:、**来源**:、**持有者**:等"
  },
  {
    name: "玩法",
    enabled: false,
    entryExample: "玩法名称",
    keywordsExample: ["玩法名", "规则名"],
    contentGuide: "基于原文的玩法/规则描述，包含但不限于**名称**:、**规则说明**:、**参与条件**:、**奖惩机制**:等"
  },
  {
    name: "章节剧情",
    enabled: false,
    entryExample: "第X章",
    keywordsExample: ["章节名", "章节号"],
    contentGuide: "该章节的剧情概要，包含但不限于**章节标题**:、**主要事件**:、**出场角色**:、**关键转折**:、**伏笔线索**:等"
  },
  {
    name: "角色内心",
    enabled: false,
    entryExample: "角色名-内心世界",
    keywordsExample: ["角色名", "内心", "心理"],
    contentGuide: "角色的内心想法和心理活动，包含但不限于**（角色名）的（某个时期）的内心世界**：、****原文内容**:、**内心独白**:、**情感变化**:、**动机分析**:、**心理矛盾**:等"
  }
]

const categories = ref<Category[]>(JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)))
const showCategories = ref(false)
const newCatName = ref('')

function addCategory() {
  const n = newCatName.value.trim()
  if (!n || categories.value.find(c => c.name === n)) return
  categories.value.push({
    name: n,
    enabled: true,
    entryExample: `${n}名称`,
    keywordsExample: [`${n}名`, `别名`],
    contentGuide: `基于原文的${n}描述，包含但不限于**名称**:、**特征**:等`
  })
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
  try {
    const re = new RegExp(chapterRegex.value, 'gm')
    const matches = [...fileContent.value.matchAll(re)]
    
    if (matches && matches.length > 0) {
      const matchTexts = matches.map(match => match[0].trim())
      
      const result: { title: string; content: string; processed?: boolean; failed?: boolean; error?: string }[] = []
      for (let i = 0; i < matches.length; i++) {
        const startIndex = matches[i].index!
        const endIndex = i < matches.length - 1 ? matches[i + 1].index! : fileContent.value.length
        
        // slice the chapter content
        const chapterContent = fileContent.value.slice(startIndex, endIndex).trim()
        const title = matchTexts[i] || `第${i + 1}章`
        
        if (chapterContent.length > 50) {
          result.push({
            title,
            content: chapterContent,
            processed: false,
            failed: false
          })
        }
      }
      chapters.value = result
    } else {
      chapters.value = []
    }
  } catch (err: any) {
    console.error('正则表达式错误:', err)
  }
}

function chunkText(text: string, size: number) {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size))
  return chunks
}

function generateMainPromptJsonTemplate(): string {
  const enabledCategories = categories.value.filter(c => c.enabled)

  let template = '{\n'
  const parts: string[] = []

  for (const cat of enabledCategories) {
    parts.push(`"${cat.name}": {
"${cat.entryExample}": {
"关键词": ${JSON.stringify(cat.keywordsExample)},
"内容": "${cat.contentGuide.replace(/"/g, '\\"')}"
}
}`)
  }

  // 添加剧情大纲（如果启用）
  if (enablePlotOutline.value) {
    parts.push(`"剧情大纲": {
"主线剧情": {
"关键词": ["主线", "核心剧情", "故事线"],
"内容": "## 故事主线\\n**核心冲突**: 故事的中心矛盾\\n**主要目标**: 主角追求的目标\\n**阻碍因素**: 实现目标的障碍\\n\\n## 剧情阶段\\n**第一幕 - 起始**: 故事开端，世界观建立\\n**第二幕 - 发展**: 冲突升级，角色成长\\n**第三幕 - 高潮**: 决战时刻，矛盾爆发\\n**第四幕 - 结局**: [如已完结] 故事收尾\\n\\n## 关键转折点\\n1. **转折点1**: 描述和影响\\n2. **转折点2**: 描述和影响\\n3. **转折点3**: 描述和影响\\n\\n## 伏笔与暗线\\n**已揭示的伏笔**: 已经揭晓的铺垫\\n**未解之谜**: 尚未解答的疑问\\n**暗线推测**: 可能的隐藏剧情线"
},
"支线剧情": {
"关键词": ["支线", "副线", "分支剧情"],
"内容": "## 主要支线\\n**支线1标题**: 简要描述\\n**支线2标题**: 简要描述\\n**支线3标题**: 简要描述\\n\\n## 支线与主线的关联\\n**交织点**: 支线如何影响主线\\n**独立价值**: 支线的独特意义"
}
}`)
  }

  // 添加文风配置（如果启用）
  if (enableLiteraryStyle.value) {
    parts.push(`"文风配置": {
"作品文风": {
"关键词": ["文风", "写作风格", "叙事特点"],
"内容": "基于原文分析的文风配置（YAML格式），包含以下三大系统：\\n\\n**叙事系统(narrative_system)**:\\n- **结构(structure)**: 故事组织方式、推进模式、结局处理\\n- **视角(perspective)**: 人称选择、聚焦类型、叙述距离\\n- **时间管理(time_management)**: 时序、时距、频率\\n- **节奏(rhythm)**: 句长模式、速度控制、标点节奏\\n\\n**表达系统(expression_system)**:\\n- **话语与描写(discourse_and_description)**: 话语风格、描写原则、具体技法\\n- **对话(dialogue)**: 对话功能、对话风格\\n- **人物塑造(characterization)**: 塑造方法、心理策略\\n- **感官编织(sensory_weaving)**: 感官优先级、通感技法\\n\\n**美学系统(aesthetics_system)**:\\n- **核心概念(core_concepts)**: 核心美学立场 and 关键词\\n- **意象与象征(imagery_and_symbolism)**: 季节意象、自然元素、色彩系统\\n- **语言与修辞(language_and_rhetoric)**: 句法特征、词汇偏好、修辞手法\\n- **整体效果(overall_effect)**: 阅读体验目标、美学哲学\\n\\n每个维度都应包含具体的原文示例和可操作的描述。"
}
}`)
  }

  template += parts.join(',\n')
  template += '\n}'

  return template
}

function generateFixPromptJsonStructure(): string {
  const enabledCategories = categories.value.filter(c => c.enabled)

  let structure = '{\n'
  const parts: string[] = []

  for (const cat of enabledCategories) {
    parts.push(`  "${cat.name}": {\n    "条目名": { "关键词": ["..."], "内容": "..." }\n  }`)
  }

  parts.push(`  "剧情大纲": {\n    "主线剧情": { "关键词": ["..."], "内容": "..." },\n    "支线剧情": { "关键词": ["..."], "内容": "..." }\n  }`)
  parts.push(`  "知识书": {\n    "条目名": { "关键词": ["..."], "内容": "..." }\n  }`)

  if (enableLiteraryStyle.value) {
    parts.push(`  "文风配置": {\n    "作品文风": { "关键词": ["文风", "写作风格", "叙事特点"], "内容": "..." }\n  }`)
  }

  structure += parts.join(',\n')
  structure += '\n}'

  return structure
}

function getCategoryNamesList(): string {
  const enabledCategories = categories.value.filter(c => c.enabled)

  const names = enabledCategories.map(cat => cat.name)
  names.push('剧情大纲', '知识书')
  if (enableLiteraryStyle.value) {
    names.push('文风配置')
  }

  return names.join('/')
}

function getEnabledCategoriesDescription(): string {
  const enabledCategories = categories.value.filter(c => c.enabled)
  return enabledCategories.map(cat => cat.name).join('、')
}

function convertWorldbookValueToString(val: any, depth = 0): string {
  if (val === null || val === undefined) {
    return '';
  }
  if (typeof val === 'string') {
    return val;
  }
  if (typeof val !== 'object') {
    return String(val);
  }
  if (Array.isArray(val)) {
    return val.map(item => {
      if (typeof item === 'object' && item !== null) {
        return convertWorldbookValueToString(item, depth + 1);
      }
      return String(item);
    }).join('\n');
  }
  return Object.keys(val).map(key => {
    const subVal = val[key];
    const indent = '  '.repeat(depth);
    if (typeof subVal === 'object' && subVal !== null) {
      const nestedStr = convertWorldbookValueToString(subVal, depth + 1);
      return `${indent}**${key}**:\n${nestedStr}`;
    }
    return `${indent}**${key}**: ${subVal}`;
  }).join('\n');
}

function normalizeWorldbookEntry(entry: any) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;

  if (entry.content !== undefined && entry['内容'] !== undefined) {
    const contentLen = String(entry.content || '').length;
    const neirongLen = String(entry['内容'] || '').length;
    if (contentLen > neirongLen) {
      entry['内容'] = entry.content;
    }
    delete entry.content;
  } else if (entry.content !== undefined) {
    entry['内容'] = entry.content;
    delete entry.content;
  }

  if (entry['内容'] !== undefined) {
    entry['内容'] = convertWorldbookValueToString(entry['内容']);
  }

  if (entry['关键词'] !== undefined) {
    if (Array.isArray(entry['关键词'])) {
      entry['关键词'] = entry['关键词'].map((k: any) => typeof k === 'object' ? convertWorldbookValueToString(k) : String(k));
    } else if (typeof entry['关键词'] === 'string') {
      entry['关键词'] = entry['关键词'].split(/[,，、\s]+/).map((k: string) => k.trim()).filter(Boolean);
    } else {
      entry['关键词'] = [convertWorldbookValueToString(entry['关键词'])];
    }
  }

  if (entry.comment !== undefined) {
    entry.comment = convertWorldbookValueToString(entry.comment);
  }

  return entry;
}

function normalizeWorldbookData(data: any) {
  if (!data || typeof data !== 'object') return data;

  for (const category in data) {
    if (typeof data[category] === 'object' && data[category] !== null && !Array.isArray(data[category])) {
      if (data[category]['关键词'] || data[category]['内容'] || data[category].content) {
        normalizeWorldbookEntry(data[category]);
      } else {
        for (const entryName in data[category]) {
          if (typeof data[category][entryName] === 'object') {
            normalizeWorldbookEntry(data[category][entryName]);
          }
        }
      }
    }
  }
  return data;
}

function parseStructuredCharacter(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  const defaultFields = [
    '名称', '性别', 'MBTI', '貌龄', '年龄', '身份', '背景', 
    '性格', '外貌', '技能', '重要事件', '话语示例', '弱点', '背景故事'
  ]
  const fieldNames = [...defaultFields]
  
  // Discover other fields in the text dynamically
  const fieldRegex = /(?:^|\n|\s)(?:\*\*([^\*：:]+)\*\*|([^\*：:\s\d]+))[:：]/g
  let match
  while ((match = fieldRegex.exec(text)) !== null) {
    const name = (match[1] || match[2]).trim()
    if (name && !fieldNames.includes(name) && name.length < 15 && isNaN(Number(name))) {
      fieldNames.push(name)
    }
  }
  
  const nextFieldsPattern = fieldNames
    .map(f => {
      const escaped = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return `\\*\\*${escaped}\\*\\*[:：]|${escaped}[:：]`
    })
    .join('|')
    
  fieldNames.forEach(field => {
    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(
      `(?:\\*\\*${escapedField}\\*\\*[:：]|${escapedField}[:：])\\s*([\\s\\S]*?)(?=\\s*(?:${nextFieldsPattern})|$)`,
      'i'
    )
    const m = text.match(regex)
    if (m) {
      result[field] = m[1].trim()
    }
  })
  
  return result
}

function calculateJaccardSimilarity(str1: string, str2: string): number {
  const set1 = new Set(str1.split(''))
  const set2 = new Set(str2.split(''))
  const intersection = new Set([...set1].filter(x => set2.has(x)))
  const union = new Set([...set1, ...set2])
  return union.size > 0 ? intersection.size / union.size : 0
}

function parseEventsList(eventsStr: string): string[] {
  const items: string[] = []
  const splitRegex = /(?:^\s*\d+[\.\、\s]+|^\s*[-*+•]\s+)/gm
  const rawParts = eventsStr.split(splitRegex)
  rawParts.forEach(p => {
    const cleaned = p.trim().replace(/\s+/g, ' ')
    if (cleaned) {
      items.push(cleaned)
    }
  })
  
  if (items.length === 0) {
    eventsStr.split(/[\n;；。]+/).forEach(p => {
      const cleaned = p.trim()
      if (cleaned) items.push(cleaned)
    })
  }
  
  return items
}

function mergeEvents(tEventsStr: string, sEventsStr: string): string {
  const tList = parseEventsList(tEventsStr)
  const sList = parseEventsList(sEventsStr)
  const mergedList: string[] = [...tList]
  
  sList.forEach(sItem => {
    const isDuplicate = mergedList.some(tItem => {
      if (tItem.includes(sItem) || sItem.includes(tItem)) return true
      return calculateJaccardSimilarity(tItem, sItem) > 0.8
    })
    if (!isDuplicate) {
      mergedList.push(sItem)
    }
  })
  
  return mergedList.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
}

function parseSkills(skillsStr: string): { name: string; detail: string }[] {
  const list = skillsStr.split(/[、,，;；\n]+/)
  const result: { name: string; detail: string }[] = []
  
  list.forEach(item => {
    const cleaned = item.trim().replace(/[。\.]$/, '')
    if (!cleaned) return
    const match = cleaned.match(/^([^\(（]+)([\(（].*[\)）])?$/)
    if (match) {
      result.push({
        name: match[1].trim(),
        detail: (match[2] || '').trim()
      })
    } else {
      result.push({ name: cleaned, detail: '' })
    }
  })
  
  return result
}

function mergeSkills(tSkillsStr: string, sSkillsStr: string): string {
  const tList = parseSkills(tSkillsStr)
  const sList = parseSkills(sSkillsStr)
  const mergedMap = new Map<string, string>()
  
  tList.forEach(s => mergedMap.set(s.name, s.detail))
  sList.forEach(s => {
    const existingDetail = mergedMap.get(s.name)
    if (existingDetail) {
      if (s.detail.length > existingDetail.length || s.detail.includes('级') && !existingDetail.includes('级')) {
        mergedMap.set(s.name, s.detail)
      } else {
        const matchT = existingDetail.match(/(\d+)级/)
        const matchS = s.detail.match(/(\d+)级/)
        if (matchT && matchS) {
          const levelT = parseInt(matchT[1], 10)
          const levelS = parseInt(matchS[1], 10)
          if (levelS > levelT) {
            mergedMap.set(s.name, s.detail)
          }
        }
      }
    } else {
      mergedMap.set(s.name, s.detail)
    }
  })
  
  return Array.from(mergedMap.entries())
    .map(([name, detail]) => `${name}${detail}`)
    .join('、')
}

function mergeTraits(tStr: string, sStr: string): string {
  const splitRegex = /[，,。；;、\n]+/
  const tParts = tStr.split(splitRegex).map(p => p.trim()).filter(Boolean)
  const sParts = sStr.split(splitRegex).map(p => p.trim()).filter(Boolean)
  const mergedParts = [...tParts]
  
  sParts.forEach(sPart => {
    const isDuplicate = mergedParts.some(tPart => tPart.includes(sPart) || sPart.includes(tPart))
    if (!isDuplicate) {
      mergedParts.push(sPart)
    }
  })
  
  return mergedParts.join('，')
}

function isStructuredCharacter(text: string): boolean {
  return text.includes('名称:') || text.includes('名称：')
}

function mergeStructuredCharacterStrings(tStr: string, sStr: string): string {
  const tParsed = parseStructuredCharacter(tStr)
  const sParsed = parseStructuredCharacter(sStr)
  const allFields = Array.from(new Set([...Object.keys(tParsed), ...Object.keys(sParsed)]))
  const preferredOrder = [
    '名称', '性别', 'MBTI', '貌龄', '年龄', '身份', '背景', 
    '性格', '外貌', '技能', '重要事件', '话语示例', '弱点', '背景故事'
  ]
  allFields.sort((a, b) => {
    const idxA = preferredOrder.indexOf(a)
    const idxB = preferredOrder.indexOf(b)
    if (idxA !== -1 && idxB !== -1) return idxA - idxB
    if (idxA !== -1) return -1
    if (idxB !== -1) return 1
    return a.localeCompare(b)
  })
  
  const merged: Record<string, string> = {}
  allFields.forEach(field => {
    const tVal = (tParsed[field] || '').trim()
    const sVal = (sParsed[field] || '').trim()
    
    if (!tVal) {
      merged[field] = sVal
      return
    }
    if (!sVal) {
      merged[field] = tVal
      return
    }
    if (tVal === sVal) {
      merged[field] = tVal
      return
    }
    
    if (field === '重要事件') {
      merged[field] = mergeEvents(tVal, sVal)
    } else if (field === '技能') {
      merged[field] = mergeSkills(tVal, sVal)
    } else {
      if (tVal.includes(sVal)) {
        merged[field] = tVal
      } else if (sVal.includes(tVal)) {
        merged[field] = sVal
      } else {
        merged[field] = mergeTraits(tVal, sVal)
      }
    }
  })
  
  return allFields
    .filter(f => merged[f])
    .map(f => `${f}: ${merged[f]}`)
    .join('\n')
}

function mergeWorldbookDataIncremental(target: any, source: any) {
  normalizeWorldbookData(source);

  for (const category in source) {
    if (typeof source[category] !== 'object' || source[category] === null) continue;

    if (!target[category]) {
      target[category] = {};
    }

    for (const entryName in source[category]) {
      const sourceEntry = source[category][entryName];
      if (typeof sourceEntry !== 'object' || sourceEntry === null) continue;

      if (target[category][entryName]) {
        const targetEntry = target[category][entryName];

        if (Array.isArray(sourceEntry['关键词']) && Array.isArray(targetEntry['关键词'])) {
          targetEntry['关键词'] = [...new Set([...targetEntry['关键词'], ...sourceEntry['关键词']])];
        } else if (Array.isArray(sourceEntry['关键词'])) {
          targetEntry['关键词'] = sourceEntry['关键词'];
        }

        if (sourceEntry['内容']) {
          const targetVal = (targetEntry['内容'] || '').trim();
          const sourceVal = (sourceEntry['内容'] || '').trim();
          if (targetVal !== sourceVal) {
            if (isStructuredCharacter(targetVal) || isStructuredCharacter(sourceVal)) {
              targetEntry['内容'] = mergeStructuredCharacterStrings(targetVal, sourceVal);
            } else if (targetVal.includes(sourceVal)) {
              // Keep target
            } else if (sourceVal.includes(targetVal)) {
              targetEntry['内容'] = sourceVal;
            } else {
              targetEntry['内容'] = targetVal + '\n\n' + sourceVal;
            }
          }
        }
      } else {
        target[category][entryName] = sourceEntry;
      }
    }
  }
}

function mergeWorldbookData(target: any, source: any) {
  normalizeWorldbookData(source);

  for (const key in source) {
    if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      mergeWorldbookData(target[key], source[key]);
    } else {
      if (key === '内容' && typeof target[key] === 'string' && typeof source[key] === 'string') {
        const targetVal = target[key].trim();
        const sourceVal = source[key].trim();
        if (targetVal !== sourceVal) {
          if (isStructuredCharacter(targetVal) || isStructuredCharacter(sourceVal)) {
            target[key] = mergeStructuredCharacterStrings(targetVal, sourceVal);
          } else if (targetVal.includes(sourceVal)) {
            // Keep target
          } else if (sourceVal.includes(targetVal)) {
            target[key] = sourceVal;
          } else {
            target[key] = targetVal + '\n\n' + sourceVal;
          }
        }
      } else {
        target[key] = source[key];
      }
    }
  }
}

function convertGeneratedWorldbookToStandard(generatedWb: any): WorldBookEntry[] {
  const standardWorldbook: WorldBookEntry[] = []
  let insertionOrder = 0

  const triggerCategories = new Set(['地点', '剧情大纲', '章节剧情'])

  Object.keys(generatedWb).forEach(category => {
    const categoryData = generatedWb[category]
    const isTriggerCategory = triggerCategories.has(category)
    const constant = !isTriggerCategory
    const selective = isTriggerCategory

    if (typeof categoryData === 'object' && categoryData !== null) {
      Object.keys(categoryData).forEach(itemName => {
        const itemData = categoryData[itemName]

        if (typeof itemData === 'object' && itemData !== null && itemData.关键词 && itemData.内容) {
          standardWorldbook.push({
            id: `${category}_${itemName}`,
            keys: Array.isArray(itemData.关键词) ? itemData.关键词 : [itemName],
            secondary_keys: [],
            comment: `[${category}] ${itemName}`,
            content: itemData.内容,
            enabled: true,
            position: 'before_char',
            constant,
            selective,
            parentId: null,
            insertion_order: insertionOrder++
          })
        } else if (typeof itemData === 'string') {
          standardWorldbook.push({
            id: `${category}_${itemName}`,
            keys: [itemName],
            secondary_keys: [],
            comment: `[${category}] ${itemName}`,
            content: itemData,
            enabled: true,
            position: 'before_char',
            constant,
            selective,
            parentId: null,
            insertion_order: insertionOrder++
          })
        }
      })
    }
  })

  return standardWorldbook
}

function extractWorldbookDataByRegex(jsonString: string): any {
  const result: any = {}
  const categoriesList = ['角色', '地点', '组织', '剧情大纲', '知识书', '文风配置', '章节剧情', '道具', '玩法', '角色内心']

  for (const category of categoriesList) {
    const categoryPattern = new RegExp(`"${category}"\\s*:\\s*\\{`, 'g')
    const categoryMatch = categoryPattern.exec(jsonString)
    if (!categoryMatch) continue

    const startPos = (categoryMatch.index ?? 0) + categoryMatch[0].length
    let braceCount = 1
    let endPos = startPos
    while (braceCount > 0 && endPos < jsonString.length) {
      if (jsonString[endPos] === '{') braceCount++
      if (jsonString[endPos] === '}') braceCount--
      endPos++
    }

    if (braceCount !== 0) continue

    const categoryContent = jsonString.substring(startPos, endPos - 1)
    result[category] = {}

    const entryPattern = /"([^"]+)"\s*:\s*\{/g
    let entryMatch: RegExpExecArray | null

    while ((entryMatch = entryPattern.exec(categoryContent)) !== null) {
      const entryName = entryMatch[1]
      const entryStartPos = (entryMatch.index ?? 0) + entryMatch[0].length

      let entryBraceCount = 1
      let entryEndPos = entryStartPos
      while (entryBraceCount > 0 && entryEndPos < categoryContent.length) {
        if (categoryContent[entryEndPos] === '{') entryBraceCount++
        if (categoryContent[entryEndPos] === '}') entryBraceCount--
        entryEndPos++
      }

      if (entryBraceCount !== 0) continue

      const entryContent = categoryContent.substring(entryStartPos, entryEndPos - 1)

      let keywords: string[] = []
      const keywordsMatch = entryContent.match(/"关键词"\s*:\s*\[([\s\S]*?)\]/)
      if (keywordsMatch) {
        const keywordStrings = keywordsMatch[1].match(/"([^"]+)"/g)
        if (keywordStrings) {
          keywords = keywordStrings.map(s => s.replace(/"/g, ''))
        }
      }

      let content = ''
      const contentMatch = entryContent.match(/"内容"\s*:\s*"/)
      if (contentMatch) {
        const contentStartPos = (contentMatch.index ?? 0) + contentMatch[0].length
        let contentEndPos = contentStartPos
        let escaped = false
        while (contentEndPos < entryContent.length) {
          const char = entryContent[contentEndPos]
          if (escaped) {
            escaped = false
          } else if (char === '\\') {
            escaped = true;
          } else if (char === '"') {
            break;
          }
          contentEndPos++
        }
        content = entryContent.substring(contentStartPos, contentEndPos)
        try {
          content = JSON.parse(`"${content}"`)
        } catch (e) {
          content = content.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        }
      }

      if (content || keywords.length > 0) {
        result[category][entryName] = {
          '关键词': keywords,
          '内容': content
        }
      }
    }
  }

  return result
}

function buildPrompt(seg: string, index: number, segments: string[], localGeneratedWorldbook: any): string {
  const jsonTemplate = generateMainPromptJsonTemplate()
  const enabledCategoriesDesc = getEnabledCategoriesDescription()

  let prompt = `你是专业的小说世界书生成专家。请仔细阅读提供的小说内容，提取其中的关键信息，生成高质量的世界书条目。

## 重要要求
1. **必须基于提供的具体小说内容**，不要生成通用模板
2. **只提取文中明确出现的${enabledCategoriesDesc}等信息**
3. **关键词必须是文中实际出现的名称**，用逗号分隔
4. **内容必须基于原文描述**，不要添加原文没有的信息
5. **内容使用markdown格式**，可以层层嵌套或使用序号标题

## 📤 输出格式
请生成标准JSON格式，确保能被JavaScript正确解析：

\`\`\`json
${jsonTemplate}
\`\`\`

## 重要提醒
- 直接输出JSON，不要包含代码块标记
- 所有信息必须来源于原文，不要编造
- 关键词必须是文中实际出现的词语
- 内容描述要完整但简洁${enablePlotOutline.value ? '\n- 剧情大纲是必需项，必须生成' : ''}${enableLiteraryStyle.value ? '\n- 文风配置字段为可选项，如果能够分析出明确的文风特征则生成，否则可以省略' : ''}

`

  if (index > 0) {
    const prevSeg = segments[index - 1]
    prompt += `这是你上一次阅读的结尾部分：
---
${prevSeg.slice(-500)}
---

`
    prompt += `这是当前你对该作品的记忆：
${JSON.stringify(localGeneratedWorldbook, null, 2)}

`
  }

  prompt += `这是你现在阅读的部分：
---
${seg}
---

`

  if (index === 0) {
    prompt += `现在开始分析小说内容，请专注于提取文中实际出现的信息：

`
  } else {
    if (incrementalMode.value) {
      prompt += `请基于新内容**增量更新**世界书，采用**点对点覆盖**模式：

**增量输出规则**：
1. **只输出本次需要变更的条目**，不要输出完整的世界书
2. **新增条目**：直接输出新条目的完整内容
3. **修改条目**：输出该条目的完整新内容（会覆盖原有内容）
4. **未变更的条目不要输出**，系统会自动保留
5. **关键词合并**：新关键词会自动与原有关键词合并，无需重复原有关键词

**示例**：如果只有"张三"角色有新信息，只需输出：
{"角色": {"张三": {"关键词": ["新称呼"], "内容": "更新后的完整描述..."}}}

`
    } else {
      prompt += `请基于新内容**累积补充**世界书，注意以下要点：

**重要规则**：
1. **已有角色**：如果角色已存在，请在原有内容基础上**追加新信息**，不要删除或覆盖已有描述
2. **新角色**：如果是新出现的角色，添加为新条目
3. **剧情大纲**：持续追踪主线发展，**追加新的剧情进展**而不是重写
4. **关键词**：为已有条目补充新的关键词（如新称呼、新关系等）
5. **保持完整性**：确保之前章节提取的重要信息不会丢失

`
    }
  }

  prompt += `请直接输出JSON格式的结果，不要添加任何代码块标记或解释文字。`

  return prompt
}

function getUsername(): string {
  return localStorage.getItem('nika_username') || ''
}

async function saveStateToServer(state: any): Promise<boolean> {
  const user = getUsername()
  if (!user) return false
  try {
    const res = await fetch('/api/novel-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    })
    return res.ok
  } catch (e) {
    console.warn('Failed to save state to server filesystem:', e)
    return false
  }
}

async function getStateFromServer(): Promise<any> {
  const user = getUsername()
  if (!user) return null
  try {
    const res = await fetch('/api/novel-state')
    if (res.ok) {
      return await res.json()
    }
  } catch (e) {
    console.warn('Failed to load state from server filesystem:', e)
  }
  return null
}

async function clearStateOnServer(): Promise<boolean> {
  const user = getUsername()
  if (!user) return false
  try {
    const res = await fetch('/api/novel-state', {
      method: 'DELETE'
    })
    return res.ok
  } catch (e) {
    console.warn('Failed to delete state on server filesystem:', e)
    return false
  }
}

async function saveState(currentIndex: number) {
  const state = cloneForStorage({
    key: 'current_state',
    fileName: fileName.value,
    fileContent: fileContent.value,
    encoding: encoding.value,
    chapterRegex: chapterRegex.value,
    chapters: chapters.value,
    incrementalMode: incrementalMode.value,
    enablePlotOutline: enablePlotOutline.value,
    enableLiteraryStyle: enableLiteraryStyle.value,
    splitSize: splitSize.value,
    localGeneratedWorldbook: localGeneratedWorldbookRef.value,
    progressCurrent: currentIndex,
    progressTotal: progress.value.total,
    lastUpdate: Date.now()
  })

  // Try saving to server first
  await saveStateToServer(state)

  // Save to IndexedDB as local fallback
  try {
    const db = await openDB(STATE_DB, 1, db => {
      if (!db.objectStoreNames.contains(STATE_STORE)) {
        db.createObjectStore(STATE_STORE, { keyPath: 'key' })
      }
    })
    await tx(db, STATE_STORE, 'readwrite', s => s.put(state))
  } catch (e) {
    console.error('Failed to auto-save progress to IndexedDB:', e)
  }
}

async function checkSavedState() {
  try {
    // Try server first
    let state = await getStateFromServer()
    let loadedFromLocal = false
    
    // Fallback to IndexedDB
    if (!state) {
      const db = await openDB(STATE_DB, 1, db => {
        if (!db.objectStoreNames.contains(STATE_STORE)) {
          db.createObjectStore(STATE_STORE, { keyPath: 'key' })
        }
      })
      state = await tx(db, STATE_STORE, 'readonly', s => s.get('current_state'))
      if (state) {
        loadedFromLocal = true
      }
    }

    if (state) {
      hasSavedState.value = true
      const processed = state.chapters.filter((c: any) => c.processed).length
      const total = state.chapters.length
      const pct = total ? Math.round((processed / total) * 100) : 0
      savedStateInfo.value = {
        fileName: state.fileName,
        progress: `${processed}/${total}`,
        percent: pct
      }
      
      if (loadedFromLocal) {
        console.log('Detected progress in local IndexedDB. Syncing to server...')
        await saveStateToServer(state)
      }
    } else {
      hasSavedState.value = false
    }
  } catch (e) {
    console.error('Failed to check saved state:', e)
  }
}

async function restoreSavedState() {
  try {
    // Try server first
    let state = await getStateFromServer()
    
    // Fallback to IndexedDB
    if (!state) {
      const db = await openDB(STATE_DB, 1, db => {
        if (!db.objectStoreNames.contains(STATE_STORE)) {
          db.createObjectStore(STATE_STORE, { keyPath: 'key' })
        }
      })
      state = await tx(db, STATE_STORE, 'readonly', s => s.get('current_state'))
    }

    if (state) {
      fileName.value = state.fileName
      fileContent.value = state.fileContent
      encoding.value = state.encoding
      chapterRegex.value = state.chapterRegex
      chapters.value = state.chapters
      incrementalMode.value = state.incrementalMode
      enablePlotOutline.value = state.enablePlotOutline
      enableLiteraryStyle.value = state.enableLiteraryStyle
      splitSize.value = state.splitSize
      localGeneratedWorldbookRef.value = state.localGeneratedWorldbook
      
      worldbook.value.name = state.fileName.replace(/\.[^.]+$/, '')
      worldbook.value.entries = convertGeneratedWorldbookToStandard(state.localGeneratedWorldbook)
      
      progress.value = {
        current: state.progressCurrent,
        total: state.progressTotal
      }
      
      hasSavedState.value = false
    }
  } catch (e) {
    console.error('Failed to restore saved state:', e)
  }
}

async function discardSavedState() {
  // Clear server state
  await clearStateOnServer()

  // Clear IndexedDB state
  try {
    const db = await openDB(STATE_DB, 1, db => {
      if (!db.objectStoreNames.contains(STATE_STORE)) {
        db.createObjectStore(STATE_STORE, { keyPath: 'key' })
      }
    })
    await tx(db, STATE_STORE, 'readwrite', s => s.delete('current_state'))
    hasSavedState.value = false
  } catch (e) {
    console.error('Failed to discard saved state:', e)
  }
}

onMounted(() => {
  checkSavedState()
})

async function generateWorldbook() {
  if (!fileContent.value) return
  const cfg = settingsService.get().apiConfig
  processing.value = true
  abortCtrl.value = new AbortController()
  currentPrompt.value = ''
  currentResponse.value = ''
  
  let localGeneratedWorldbook = localGeneratedWorldbookRef.value

  if (Object.keys(localGeneratedWorldbook).length === 0) {
    if (!incrementalMode.value) {
      worldbook.value = { name: fileName.value.replace(/\.[^.]+$/, ''), entries: [] }
    } else if (!worldbook.value.name) {
      worldbook.value.name = fileName.value.replace(/\.[^.]+$/, '')
    }

    if (incrementalMode.value && worldbook.value.entries.length > 0) {
      worldbook.value.entries.forEach(entry => {
        const match = entry.comment.match(/^\[(.*?)\]\s*(.*)$/)
        let category = '知识书'
        let itemName = entry.comment
        if (match) {
          category = match[1]
          itemName = match[2]
        }
        if (!localGeneratedWorldbook[category]) {
          localGeneratedWorldbook[category] = {}
        }
        localGeneratedWorldbook[category][itemName] = {
          '关键词': entry.keys,
          '内容': entry.content
        }
      })
    } else {
      localGeneratedWorldbook = {
        '角色': {},
        '地点': {},
        '组织': {},
        '知识书': {}
      }
    }
    localGeneratedWorldbookRef.value = localGeneratedWorldbook
  }

  const segments = chapters.value.length > 0
    ? chapters.value.map(c => `【${c.title}】\n${c.content}`)
    : chunkText(fileContent.value, splitSize.value)

  progress.value = { current: progress.value.current || 0, total: segments.length }

  for (let idx = 0; idx < segments.length; idx++) {
    if (abortCtrl.value.signal.aborted) break

    // Skip already successfully processed chapters
    if (chapters.value.length > 0 && chapters.value[idx]?.processed) {
      continue
    }

    progress.value.current = idx + 1
    const seg = segments[idx]
    
    try {
      let json = ''
      currentPrompt.value = buildPrompt(seg, idx, segments, localGeneratedWorldbook)
      currentResponse.value = ''
      
      await streamChat(cfg, [{ role: 'user', content: currentPrompt.value }], d => {
        json += d
        currentResponse.value = json
      }, abortCtrl.value.signal)
      
      let memoryUpdate: any = null
      try {
        memoryUpdate = JSON.parse(json)
      } catch (jsonError: any) {
        let cleanResponse = json.trim()
        cleanResponse = cleanResponse.replace(/```json\s*/gi, '').replace(/```\s*/g, '')
        if (!cleanResponse.startsWith('{')) {
          const firstBrace = cleanResponse.indexOf('{')
          const lastBrace = cleanResponse.lastIndexOf('}')
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            cleanResponse = cleanResponse.substring(firstBrace, lastBrace + 1)
          }
        }
        
        try {
          memoryUpdate = JSON.parse(cleanResponse)
        } catch (secondError: any) {
          const openBraces = (cleanResponse.match(/{/g) || []).length
          const closeBraces = (cleanResponse.match(/}/g) || []).length
          const missingBraces = openBraces - closeBraces
          
          let parsedWithAutoFix = false
          if (missingBraces > 0) {
            try {
              memoryUpdate = JSON.parse(cleanResponse + '}'.repeat(missingBraces))
              parsedWithAutoFix = true
            } catch (autoFixErr) {
              // Ignore
            }
          }
          
          if (!parsedWithAutoFix) {
            const regexExtractedData = extractWorldbookDataByRegex(cleanResponse)
            if (regexExtractedData && Object.keys(regexExtractedData).length > 0) {
              memoryUpdate = regexExtractedData
            } else {
              // Format fixing prompt
              const fixPrompt = `你是专业的JSON修复专家。请将下面“格式错误的JSON文本”修复为严格有效、可被 JavaScript 的 JSON.parse() 直接解析的JSON。

## 📋 核心要求
1. **只修复格式**：保持原有数据语义与内容不变，不要总结、不要改写字段名、不要增删字段。
2. **输出必须是单个JSON对象**：返回内容必须从第一个字符“{”开始，到最后一个字符“}”结束。
3. **禁止任何额外输出**：不要包含解释文字、不要包含Markdown、不要包含代码块标记、不要包含前后缀、不要输出多段内容。
4. **严格JSON语法**：
   - 所有key必须用双引号包裹
   - 字符串必须使用双引号
   - 不允许尾随逗号
   - 不允许注释
5. **字符串换行与特殊字符必须正确转义**：字符串中的换行必须使用 \\n，反斜杠与引号必须正确转义。

## 🧩 世界书JSON基本嵌套结构（必须遵循）
修复后的JSON应尽量保持/恢复为以下结构（允许只包含其中一部分分类，但结构层级必须一致）：

${generateFixPromptJsonStructure()}

要求：
- 顶层的每个分类（例如"${getCategoryNamesList()}"）的值必须是对象。
- 分类下每个条目的值必须是对象，且包含 "关键词"(数组) 与 "内容"(字符串) 两个字段。
- 如果原文中某条目值不是对象（比如直接是字符串），请在不改变语义的前提下包装成 {"关键词":[], "内容":"原内容"}。

## 📤 输出格式
直接输出修复后的JSON（不要包含任何其他字符）。

## 错误信息（用于定位，不需要复述）
${secondError.message}

## 需要修复的JSON文本
${cleanResponse}
`
              let fixedJson = ''
              await streamChat(cfg, [{ role: 'user', content: fixPrompt }], d => {
                fixedJson += d
              }, abortCtrl.value.signal)
              
              let cleanedFixed = fixedJson.trim().replace(/```json\s*/gi, '').replace(/```\s*/g, '')
              const firstBrace = cleanedFixed.indexOf('{')
              const lastBrace = cleanedFixed.lastIndexOf('}')
              if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleanedFixed = cleanedFixed.substring(firstBrace, lastBrace + 1)
              }
              
              try {
                memoryUpdate = JSON.parse(cleanedFixed)
              } catch (fixErr: any) {
                throw new Error(`JSON解析失败且自动修复失败: ${secondError.message}. 纠正错误: ${fixErr.message}`)
              }
            }
          }
        }
      }

      if (memoryUpdate) {
        if (incrementalMode.value) {
          mergeWorldbookDataIncremental(localGeneratedWorldbook, memoryUpdate)
        } else {
          mergeWorldbookData(localGeneratedWorldbook, memoryUpdate)
        }
        worldbook.value.entries = convertGeneratedWorldbookToStandard(localGeneratedWorldbook)
        
        if (chapters.value[idx]) {
          chapters.value[idx].processed = true
          chapters.value[idx].failed = false
          chapters.value[idx].error = undefined
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        break
      }
      console.error(`处理章节 ${idx + 1} 时出错:`, err)
      if (chapters.value[idx]) {
        chapters.value[idx].processed = false
        chapters.value[idx].failed = true
        chapters.value[idx].error = err.message || '未知错误'
      }
    }
    
    // Auto-save state
    await saveState(idx + 1)
  }
  
  processing.value = false
  
  // If all chapters are processed successfully, discard state
  const hasFailed = chapters.value.some(c => c.failed)
  if (!hasFailed && progress.value.current >= segments.length) {
    await discardSavedState()
  }
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
  await charStore.load()
  const targetName = worldbook.value.name || '新角色'
  
  // Find if there is an existing character card with the same name and "世界书" tag, or just same name
  const existing = charStore.characters.find(
    c => c.name === targetName && c.tags.includes('世界书')
  ) || charStore.characters.find(
    c => c.name === targetName
  )

  if (existing) {
    // Merge new worldbook into the existing one
    const existingBook = existing.cardData.data.character_book || { name: existing.name, entries: [] }
    
    // Create a map of existing entries by id or comment
    const entryMap = new Map<string, WorldBookEntry>()
    existingBook.entries.forEach(e => {
      const key = e.id || e.comment
      entryMap.set(key, e)
    })
    
    // Merge new entries
    worldbook.value.entries.forEach(newEntry => {
      const key = newEntry.id || newEntry.comment
      const existingEntry = entryMap.get(key)
      
      if (existingEntry) {
        // Merge keys
        existingEntry.keys = [...new Set([...existingEntry.keys, ...newEntry.keys])]
        // Smart merge content
        const existingContent = (existingEntry.content || '').trim()
        const newContent = (newEntry.content || '').trim()
        if (existingContent !== newContent) {
          if (existingContent.includes(newContent)) {
            // Keep existing
          } else if (newContent.includes(existingContent)) {
            existingEntry.content = newContent
          } else {
            existingEntry.content = existingContent + '\n\n' + newContent
          }
        }
      } else {
        // Add new entry
        existingBook.entries.push(newEntry)
      }
    })
    
    // Update the existing character
    existing.cardData.data.character_book = existingBook
    existing.updatedAt = Date.now()
    
    await charStore.save(existing)
    console.log('[Novel Extractor] Merged and updated existing character card in library.')
  } else {
    // Create new character card
    const char: Character = {
      id: crypto.randomUUID(), name: targetName,
      avatar: undefined, tags: ['世界书'], isFavorite: false,
      createdAt: Date.now(), updatedAt: Date.now(),
      cardData: {
        spec: 'chara_card_v2', spec_version: '2.0',
        data: {
          name: targetName, description: '', personality: '',
          scenario: '', first_mes: '', mes_example: '',
          creator_notes: '', system_prompt: '', post_history_instructions: '',
          tags: [], creator: '', character_version: '',
          character_book: worldbook.value,
        }
      }
    }
    await charStore.save(char)
    console.log('[Novel Extractor] Created new character card in library.')
  }
  router.push('/')
}

async function createIndependentCharacterCard(entry: WorldBookEntry) {
  // Extract character name from entry.comment, e.g. "[角色] 依韵" -> "依韵"
  const charName = entry.comment.replace(/^\[角色\]\s*/, '').trim()
  
  // Parse structured character card fields from entry.content
  const parsed = parseStructuredCharacter(entry.content)
  
  // Create or update character card in the library
  await charStore.load()
  const existing = charStore.characters.find(c => c.name === charName && !c.tags.includes('世界书'))
  
  // Prepare description, personality, scenario, first message
  const description = [
    parsed.背景 ? `【背景设定】\n${parsed.背景}` : '',
    parsed.外貌 ? `【外貌特征】\n${parsed.外貌}` : '',
    parsed.技能 ? `【生活与战斗技能】\n${parsed.技能}` : '',
    parsed.弱点 ? `【弱点短板】\n${parsed.弱点}` : '',
    parsed.背景故事 ? `【背景故事】\n${parsed.背景故事}` : ''
  ].filter(Boolean).join('\n\n')

  const personality = [
    parsed.性格 ? `【性格特质】\n${parsed.性格}` : '',
    parsed.MBTI ? `【MBTI倾向】\n${parsed.MBTI}` : ''
  ].filter(Boolean).join('\n\n')

  const scenario = [
    parsed.重要事件 ? `【当前故事线经历与重要转折】\n${parsed.重要事件}` : ''
  ].filter(Boolean).join('\n\n')

  const firstMes = parsed.话语示例 ? parsed.话语示例.replace(/^["'“‘]|["'”’]$/g, '') : `你好，我是${charName}。`
  
  if (existing) {
    // Update existing character card
    existing.cardData.data.name = charName
    existing.cardData.data.description = description
    existing.cardData.data.personality = personality
    existing.cardData.data.scenario = scenario
    existing.cardData.data.first_mes = firstMes
    // Auto-update Author's Note based on latest events
    existing.cardData.data.extensions ??= {}
    existing.cardData.data.extensions.depth_prompt = {
      prompt: `[当前剧情阶段：${charName}${parsed.身份 ? '（' + parsed.身份 + '）' : ''}${parsed.重要事件 ? '。最近重大事件：' + parsed.重要事件 : '已登场。'}]`,
      depth: 4,
      role: 'system'
    }
    // Link worldbook from the current state so the character has access to it!
    existing.cardData.data.character_book = worldbook.value
    existing.updatedAt = Date.now()
    
    await charStore.save(existing)
    alert(`成功更新角色卡 [${charName}]！此卡已与最新世界书关联绑定，并且已根据当前提取结果更新了“作者附言(Author's Note)”。`)
  } else {
    // Create new character card
    const char: Character = {
      id: crypto.randomUUID(),
      name: charName,
      avatar: undefined,
      tags: ['小说角色'],
      isFavorite: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cardData: {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name: charName,
          description,
          personality,
          scenario,
          first_mes: firstMes,
          mes_example: parsed.话语示例 ? `<user>: 你好\n<char>: ${parsed.话语示例}` : '',
          creator_notes: '由 Nika Studio 从小说文本中智能生成。',
          system_prompt: '',
          post_history_instructions: '',
          tags: ['从小说生成'],
          creator: 'Nika Studio',
          character_version: '1.0',
          character_book: worldbook.value, // Link entire novel world book!
          extensions: {
            depth_prompt: {
              prompt: `[当前剧情阶段：${charName}${parsed.身份 ? '（' + parsed.身份 + '）' : ''}${parsed.重要事件 ? '。最近重大事件：' + parsed.重要事件 : '已登场。'}]`,
              depth: 4,
              role: 'system'
            }
          }
        }
      }
    }
    await charStore.save(char)
    alert(`成功在您的本地库创建独立角色卡 [${charName}]！此卡已与世界书关联绑定，且自动配置了初始的“作者附言(Author's Note)”，可直接导出并在 SillyTavern 中运行。`)
  }
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

    <div class="flex-1 max-w-7xl mx-auto w-full p-5 flex flex-col lg:flex-row gap-6 items-start animate-fade-in">
      <!-- Left Column: Inputs & Controls (Sticky on Desktop) -->
      <div class="w-full lg:w-[380px] shrink-0 flex flex-col gap-4 lg:sticky lg:top-20">
        
        <!-- Resume Progress Banner -->
        <div v-if="hasSavedState" class="glass-card rounded-2xl p-4 border border-purple-500/20 bg-purple-500/5 flex flex-col gap-2.5 shadow-md animate-fade-in">
          <div class="flex items-center gap-3">
            <span class="text-2xl">⏳</span>
            <div class="flex flex-col flex-1">
              <span class="text-xs font-bold text-zinc-100">检测到上次的分析进度</span>
              <span class="text-[10px] text-zinc-400 mt-0.5">文件: {{ savedStateInfo.fileName }} | 进度: {{ savedStateInfo.progress }} ({{ savedStateInfo.percent }}%)</span>
            </div>
          </div>
          <div class="flex gap-2 justify-end">
            <button @click="discardSavedState" class="btn-secondary text-[10px] py-1.5 px-3 rounded-lg text-zinc-400">放弃并清除</button>
            <button @click="restoreSavedState" class="btn-primary text-[10px] py-1.5 px-3 rounded-lg font-bold">恢复进度</button>
          </div>
        </div>

        <!-- Upload Drop Zone -->
        <div @dragover.prevent @drop="onDrop"
          class="group border-2 border-dashed border-white/10 hover:border-purple-500/40 bg-zinc-950/20 hover:bg-purple-500/5 rounded-2xl p-6 text-center transition-all duration-300 cursor-pointer shadow-inner flex flex-col items-center justify-center min-h-[140px] hover:scale-[1.005]"
          @click="fileInputEl?.click()">
          <input ref="fileInputEl" type="file" accept=".txt" class="hidden" @change="loadFile" />
          <span class="text-4xl mb-2 block transform group-hover:scale-110 transition-transform duration-300">📄</span>
          <p v-if="fileName" class="font-extrabold text-[var(--primary)] text-[11px] tracking-wide bg-purple-500/5 border border-purple-500/20 py-1 px-3 rounded-lg shadow-sm truncate max-w-full">{{ fileName }}</p>
          <p v-else class="text-xs font-bold text-zinc-300 group-hover:text-purple-300 transition-colors">拖拽或点击上传小说 .txt 文件</p>
          <p v-if="fileContent" class="text-[9px] text-[var(--text-muted)] mt-1.5 font-mono bg-zinc-950/40 border border-white/5 px-2 py-0.5 rounded">{{ fileContent.length.toLocaleString() }} 字符</p>
        </div>

        <!-- Options Configuration -->
        <div class="glass-card rounded-2xl p-4 border border-white/5 flex flex-col gap-3 shadow-md">
          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-1">
              <label class="label">文件编码</label>
              <select v-model="encoding" class="input cursor-pointer bg-zinc-950 py-2 text-xs">
                <option v-for="e in encodings" :key="e" :value="e" class="bg-zinc-950">{{ e === 'auto' ? '自动检测' : e }}</option>
              </select>
            </div>
            
            <div class="flex flex-col gap-1">
              <label class="label">分段字数限制</label>
              <select v-model="splitSize" class="input cursor-pointer bg-zinc-950 py-2 text-xs">
                <option :value="1500" class="bg-zinc-950">1500字</option>
                <option :value="3000" class="bg-zinc-950">3000字</option>
                <option :value="5000" class="bg-zinc-950">5000字</option>
              </select>
            </div>
          </div>
          
          <div class="flex flex-col gap-1">
            <label class="label">章节识别正则 (Regex)</label>
            <div class="flex gap-2">
              <input v-model="chapterRegex" class="input flex-1 font-mono text-xs py-2 px-2.5" />
              <button @click="detectChapters" :disabled="!fileContent" class="btn-secondary whitespace-nowrap text-[11px] font-bold px-3 py-2 rounded-xl cursor-pointer">识别</button>
            </div>
          </div>

          <div class="border-t border-white/5 pt-3 flex flex-col gap-2.5">
            <div class="flex items-center justify-between">
              <div class="flex flex-col">
                <span class="text-[11px] font-bold text-zinc-100">生成剧情大纲</span>
                <span class="text-[9px] text-[var(--text-muted)] mt-0.5">分析并生成故事的主线与支线剧情</span>
              </div>
              <input type="checkbox" v-model="enablePlotOutline" class="accent-[var(--primary)] w-4 h-4 rounded cursor-pointer" />
            </div>
            <div class="flex items-center justify-between border-t border-white/5 pt-2.5">
              <div class="flex flex-col">
                <span class="text-[11px] font-bold text-zinc-100">分析写作文风</span>
                <span class="text-[9px] text-[var(--text-muted)] mt-0.5">提取叙事、表达与美学文风参数</span>
              </div>
              <input type="checkbox" v-model="enableLiteraryStyle" class="accent-[var(--primary)] w-4 h-4 rounded cursor-pointer" />
            </div>
          </div>
        </div>

        <!-- Incremental Mode Banner -->
        <div class="glass-card rounded-2xl p-3 border border-white/5 flex items-center justify-between shadow-sm">
          <div class="flex items-center gap-2.5">
            <span class="text-lg">🔄</span>
            <div class="flex flex-col">
              <span class="text-[11px] font-bold text-zinc-100">智能增量提取模式</span>
              <span class="text-[9px] text-[var(--text-muted)] mt-0.5">开启后将自动覆盖已有条目，合并触发关键词</span>
            </div>
          </div>
          <label class="relative inline-flex items-center cursor-pointer select-none">
            <input type="checkbox" v-model="incrementalMode" class="accent-[var(--primary)] w-4 h-4 rounded cursor-pointer" />
          </label>
        </div>

        <!-- Categories Configuration -->
        <div class="glass-card rounded-2xl overflow-hidden border border-white/5 shadow-sm">
          <button @click="showCategories = !showCategories"
            class="w-full px-4 py-3 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:bg-white/5 transition-colors cursor-pointer border-b border-white/5 bg-zinc-900/10">
            <span class="flex items-center gap-1">📂 提取范畴（{{ categories.filter(c=>c.enabled).length }}/{{ categories.length }}）</span>
            <span>{{ showCategories ? '▲ 收起' : '▼ 展开' }}</span>
          </button>
          
          <div v-if="showCategories" class="px-4 pb-4 flex flex-col gap-2.5 pt-2.5">
            <div v-for="(cat, i) in categories" :key="cat.name"
              class="flex items-center gap-2.5 py-1.5 border-b border-white/5 last:border-0">
              <label class="flex items-center gap-1.5 shrink-0 cursor-pointer">
                <input type="checkbox" v-model="cat.enabled" class="accent-[var(--primary)] w-3.5 h-3.5 rounded" />
                <span class="text-xs font-bold text-zinc-200 w-12">{{ cat.name }}</span>
              </label>
              <input v-model="cat.contentGuide" class="input flex-1 py-1 px-2 text-[11px]" placeholder="提取指导..." />
              <button v-if="!['角色','地点','组织','道具','玩法','章节剧情','角色内心'].includes(cat.name)"
                @click="removeCategory(i)" class="text-red-400 hover:text-red-300 text-xs shrink-0 cursor-pointer p-0.5">✕</button>
            </div>
            
            <!-- Add category -->
            <div class="flex gap-1.5 mt-2 pt-2 border-t border-white/5">
              <input v-model="newCatName" @keydown.enter.prevent="addCategory"
                class="input flex-1 text-[11px] py-1.5 px-2" placeholder="新增分类 (如: 武器)..." />
              <button @click="addCategory" class="btn-secondary text-[10px] px-2.5 py-1.5 rounded-lg font-bold shrink-0">+ 新增</button>
              <button @click="categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES))"
                class="btn-secondary text-[10px] px-2.5 py-1.5 rounded-lg font-bold text-zinc-400 border-dashed shrink-0" title="重置为默认分类">重置</button>
            </div>
          </div>
        </div>

      </div>

      <!-- Right Column: Live Output & Results -->
      <div class="flex-1 w-full min-w-0 flex flex-col gap-5">
        
        <!-- Action Button -->
        <div class="flex gap-2.5 shrink-0">
          <button @click="generateWorldbook" :disabled="!fileContent || processing" class="btn-primary flex-1 py-3 text-xs font-extrabold shadow-lg shadow-purple-500/20">
            🔮 开始 AI 智能解析世界设定
          </button>
          <button v-if="processing" @click="stopProcessing" class="btn-danger py-3 text-xs font-extrabold px-4.5 rounded-xl shadow-lg shadow-red-500/10 shrink-0 animate-pulse">
            ■ 停止
          </button>
        </div>

        <!-- Chapters Preview with Status Marks (Collapsible) -->
        <div v-if="chapters.length" class="glass-card rounded-2xl border border-white/5 shadow-sm animate-fade-in flex flex-col overflow-hidden">
          <button @click="showChaptersList = !showChaptersList"
            :class="[
              'w-full px-4 py-3 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:bg-white/5 transition-colors cursor-pointer bg-zinc-900/10 select-none',
              showChaptersList ? 'border-b border-white/5' : ''
            ]">
            <span class="flex items-center gap-1.5 text-zinc-300">章节处理进度 (已完成：{{ chapters.filter(c=>c.processed).length }}/{{ chapters.length }})</span>
            <span>{{ showChaptersList ? '▲ 收起' : '▼ 展开' }}</span>
          </button>
          
          <div v-if="showChaptersList" class="p-4 flex flex-wrap gap-2 max-h-56 overflow-y-auto pr-1 scroll-thin">
            <div v-for="(c, idx) in chapters" :key="c.title + '-' + idx" 
              class="flex items-center gap-1.5 text-[11px] py-1 px-2.5 rounded-full border transition-all cursor-default select-none"
              :class="[
                c.processed ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15' : 
                c.failed ? 'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/15 cursor-help' : 
                (processing && progress.current === idx + 1) ? 'bg-purple-500/15 border-purple-500/40 text-purple-300 animate-pulse' : 
                'bg-zinc-950/30 border-white/5 text-zinc-400 hover:border-white/10 hover:text-zinc-300'
              ]"
              :title="c.failed ? c.error : `${c.title} (${c.content.length.toLocaleString()}字)`">
              
              <span class="text-[9px] leading-none">
                <span v-if="c.processed">✔️</span>
                <span v-else-if="c.failed">❌</span>
                <span v-else-if="processing && progress.current === idx + 1" class="inline-block animate-pulse">⚡</span>
                <span v-else>⏳</span>
              </span>

              <span class="font-bold truncate max-w-[90px]">{{ c.title }}</span>
              <span class="text-[9px] opacity-75 font-mono">({{ c.content.length.toLocaleString() }}字)</span>
            </div>
          </div>
        </div>
        
        <!-- Placeholder when idle -->
        <div v-if="!processing && !worldbook.entries.length && !progress.total"
          class="glass-card rounded-3xl p-12 text-center text-zinc-500 border border-white/5 flex flex-col items-center justify-center min-h-[380px] animate-fade-in shadow-lg">
          <span class="text-6xl mb-4 block animate-bounce duration-[2000ms]">🔮</span>
          <p class="font-extrabold text-sm text-zinc-300 tracking-wide">等待智能提取任务开始</p>
          <p class="text-xs text-[var(--text-muted)] mt-2.5 leading-relaxed max-w-sm">
            在左侧上传小说文档（.txt），配置好章节规则与要提取的分类设定，然后点击底部的<strong>“开始 AI 智能解析”</strong>。
            提取的实时生成细节（Prompt 语句与 AI 流式回包）以及最终的世界书清单将会动态呈现在此处。
          </p>
        </div>

        <!-- Progress Tracking & LLM Streams -->
        <div v-if="processing || progress.total > 0" class="glass-card p-5 rounded-2xl border border-white/5 shadow-sm animate-fade-in flex flex-col gap-4">
          <!-- Progress Bar Header -->
          <div class="flex justify-between text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
            <span>{{ processing ? 'AI 正在全力提取剧情中...' : '设定提取已完成' }} (已处理：{{ progress.current }}/{{ progress.total }})</span>
            <span class="text-purple-400 font-mono font-bold">{{ progressPct }}%</span>
          </div>
          <div class="h-2 bg-zinc-950 rounded-full overflow-hidden border border-white/5 shadow-inner">
            <div class="h-full bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 transition-all duration-300 animate-pulse" :style="{ width: progressPct + '%' }" />
          </div>

          <!-- Prompt vs Response Grid -->
          <div v-if="processing && (currentPrompt || currentResponse)" class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2 border-t border-white/5 pt-4 animate-fade-in">
            <!-- Left Column: Prompt -->
            <div class="flex flex-col gap-1.5 min-w-0">
              <h5 class="text-[9px] font-extrabold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                <span>发送给大模型的 Prompt (片段 {{ progress.current }})</span>
              </h5>
              <textarea readonly :value="currentPrompt" class="input font-mono text-[10px] leading-relaxed resize-none h-44 bg-zinc-950/60 text-zinc-300 border border-white/5 scroll-thin" />
            </div>

            <!-- Right Column: Streaming Response -->
            <div class="flex flex-col gap-1.5 min-w-0">
              <h5 class="text-[9px] font-extrabold text-purple-400 uppercase tracking-widest flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse"></span>
                <span>大模型实时回复 (Streaming JSON Response)</span>
              </h5>
              <textarea readonly :value="currentResponse" class="input font-mono text-[10px] leading-relaxed resize-none h-44 bg-zinc-950/60 text-purple-300 border border-purple-500/10 shadow-[0_0_15px_rgba(168,85,247,0.05)] scroll-thin" />
            </div>
          </div>
        </div>

        <!-- Worldbook Extraction Results -->
        <div v-if="worldbook.entries.length" class="glass-card rounded-3xl p-5 border border-white/5 flex flex-col gap-4 shadow-xl animate-fade-in shadow-black/35">
          <div class="flex justify-between items-center border-b border-white/5 pb-3 shrink-0">
            <span class="font-extrabold text-sm tracking-wide text-purple-300 flex items-center gap-1.5">
              <span>🎉</span> 提取到 {{ worldbook.entries.length }} 条世界书设定
            </span>
            <div class="flex gap-2">
              <button @click="exportWorldbook" class="btn-secondary text-xs py-2 px-4 rounded-xl font-bold cursor-pointer">📂 导出 JSON 世界书</button>
              <button @click="saveToLibrary" class="btn-primary text-xs py-2 px-4 rounded-xl font-extrabold shadow-lg shadow-purple-500/15 cursor-pointer">💾 存入角色库</button>
            </div>
          </div>
          
          <div class="flex flex-col gap-2.5 max-h-[60vh] overflow-y-auto pr-1 scroll-thin">
            <div v-for="entry in worldbook.entries" :key="entry.id"
              class="bg-zinc-900/35 border border-white/5 rounded-2xl p-4 text-xs shadow-inner hover:border-purple-500/10 transition-all animate-fade-in flex flex-col relative overflow-hidden shrink-0">
              <div class="text-[var(--primary)] font-extrabold mb-1.5 flex items-center justify-between">
                <span class="text-zinc-100 text-sm">{{ entry.comment || '未命名分类' }}</span>
                <div class="flex items-center gap-2">
                  <button v-if="entry.comment && entry.comment.startsWith('[角色]')" 
                    @click.stop="createIndependentCharacterCard(entry)" 
                    class="text-[9px] bg-purple-500/20 hover:bg-purple-500/35 border border-purple-500/30 text-purple-300 px-2.5 py-1.5 rounded-lg transition-all font-bold cursor-pointer select-none active:scale-95 shadow-sm"
                  >
                    👤 生成独立角色卡
                  </button>
                  <span class="text-[9px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/20 px-2.5 py-1.5 rounded-lg font-mono">🔑 {{ entry.keys.join(', ') || '(无触发词)' }}</span>
                </div>
              </div>
              
              <div 
                class="markdown-body text-zinc-300 mt-2 border-t border-white/5 pt-2 select-text font-medium"
                :class="isExpanded(entry.id) ? 'pb-2' : (isContentLong(entry.content) ? 'max-h-[72px] overflow-hidden mask-gradient pb-2' : 'pb-2')"
                v-html="renderMarkdown(entry.content)"
              />

              <!-- Toggle Button -->
              <div v-if="isContentLong(entry.content)" class="flex justify-end mt-2 pt-1 border-t border-white/3">
                <button 
                  @click="toggleEntry(entry.id)" 
                  class="text-[10px] text-purple-400 hover:text-purple-300 font-bold flex items-center gap-0.5 transition-colors cursor-pointer select-none"
                >
                  <span>{{ isExpanded(entry.id) ? '▲ 收起' : '▼ 展开' }}</span>
                </button>
              </div>
            </div>
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

/* Scrollbar styling for code views */
.scroll-thin {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.05) transparent;
}
.scroll-thin::-webkit-scrollbar {
  width: 4px;
}
.scroll-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scroll-thin::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 9999px;
}

.mask-gradient {
  mask-image: linear-gradient(to bottom, black 30%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black 30%, transparent 100%);
}

/* Markdown content styling */
.markdown-body :deep(p) {
  @apply mb-2 last:mb-0 leading-relaxed;
}
.markdown-body :deep(strong) {
  @apply text-zinc-100 font-bold;
}
.markdown-body :deep(ul), .markdown-body :deep(ol) {
  @apply pl-4 mb-2;
}
.markdown-body :deep(ul) {
  @apply list-disc;
}
.markdown-body :deep(ol) {
  @apply list-decimal;
}
.markdown-body :deep(li) {
  @apply mb-1;
}
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3), .markdown-body :deep(h4) {
  @apply font-bold text-zinc-100 mt-2 mb-1;
}
</style>
