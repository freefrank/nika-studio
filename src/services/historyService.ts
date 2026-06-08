import type { Character } from '@/types'
import { cloneForStorage, openDB, tx } from './db'

export interface CharacterSnapshot {
  id: string
  charId: string
  source: 'agent_patch'
  messageId: string
  reason: string
  character: Character
  createdAt: number
}

const DB = 'NikaHistoryDB'
const STORE = 'character_snapshots'

async function getDB() {
  return openDB(DB, 1, db => {
    if (!db.objectStoreNames.contains(STORE)) {
      const store = db.createObjectStore(STORE, { keyPath: 'id' })
      store.createIndex('charId', 'charId')
      store.createIndex('createdAt', 'createdAt')
    }
  })
}

export const historyService = {
  async saveAgentPatchSnapshot(params: {
    character: Character
    messageId: string
    reason: string
  }): Promise<CharacterSnapshot> {
    const record = cloneForStorage({
      id: crypto.randomUUID(),
      charId: params.character.id,
      source: 'agent_patch' as const,
      messageId: params.messageId,
      reason: params.reason,
      character: params.character,
      createdAt: Date.now(),
    })
    const db = await getDB()
    await tx(db, STORE, 'readwrite', s => s.put(record))
    return record
  },
}
