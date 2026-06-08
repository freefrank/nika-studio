// Character card (SillyTavern V2/V3 compatible)
export interface RegexScript {
  id: string
  scriptName: string
  findRegex: string
  replaceString: string
  enabled: boolean
  placement?: string[]
  markdownOnly?: boolean
}

export interface CharacterData {
  spec: 'chara_card_v2' | 'chara_card_v3'
  spec_version: string
  data: {
    name: string
    description: string
    personality: string
    scenario: string
    first_mes: string
    mes_example: string
    creator_notes: string
    system_prompt: string
    post_history_instructions: string
    tags: string[]
    creator: string
    character_version: string
    character_book?: WorldBook
    avatar?: string
    alternate_greetings?: string[]
    regex_scripts?: RegexScript[]
  }
}

export interface WorldBookEntry {
  id: string
  keys: string[]
  content: string
  enabled: boolean
  insertion_order: number
  comment: string
  selective: boolean
  secondary_keys: string[]
  constant: boolean
  position: 'before_char' | 'after_char'
  depth?: number
  parentId?: string | null
  children?: WorldBookEntry[]
}

export interface WorldBook {
  name: string
  entries: WorldBookEntry[]
}

export interface Character {
  id: string
  name: string
  avatar?: string
  tags: string[]
  isFavorite: boolean
  createdAt: number
  updatedAt: number
  cardData: CharacterData
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  isEditing?: boolean
}

export interface ChatSession {
  id: string
  characterId: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface ApiConfig {
  provider: 'deepseek' | 'gemini' | 'openai-compat' | 'local'
  apiKey: string
  baseUrl?: string
  model: string
  useProxy?: boolean
}

export interface AppSettings {
  apiConfig: ApiConfig
  language: 'zh' | 'en'
  debug: boolean
  limitlessPrompt: string
}
