import { cloneForStorage, openDB, tx } from './db'

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  snapshot?: string // JSON snapshot of card before this message
  timestamp: number
}

const DB = 'NikaAgentDB'
const STORE = 'agent_chats'

async function getDB() {
  return openDB(DB, 1, db => {
    if (!db.objectStoreNames.contains(STORE))
      db.createObjectStore(STORE, { keyPath: 'charId' })
  })
}

export const agentDB = {
  async load(charId: string): Promise<AgentMessage[]> {
    const db = await getDB()
    const row = await tx<{ charId: string; messages: AgentMessage[] } | undefined>(db, STORE, 'readonly', s => s.get(charId))
    return row?.messages ?? []
  },
  async save(charId: string, messages: AgentMessage[]): Promise<void> {
    const record = cloneForStorage({ charId, messages, updatedAt: Date.now() })
    const db = await getDB()
    await tx(db, STORE, 'readwrite', s => s.put(record))
  },
}
