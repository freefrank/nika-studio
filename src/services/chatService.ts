import type { ChatSession } from '@/types'
import { cloneForStorage, openDB, tx } from './db'

const DB = 'NikaChatDB'
const STORE = 'sessions'

async function getDB() {
  return openDB(DB, 1, db => {
    if (!db.objectStoreNames.contains(STORE))
      db.createObjectStore(STORE, { keyPath: 'id' })
  })
}

export const chatService = {
  async getAll(): Promise<ChatSession[]> {
    const db = await getDB()
    return tx(db, STORE, 'readonly', s => s.getAll())
  },

  async get(id: string): Promise<ChatSession | undefined> {
    const db = await getDB()
    return tx(db, STORE, 'readonly', s => s.get(id))
  },

  async getByCharacter(characterId: string): Promise<ChatSession | undefined> {
    const all = await chatService.getAll()
    return all.find(s => s.characterId === characterId)
  },

  async save(session: ChatSession): Promise<ChatSession> {
    const record = cloneForStorage({ ...session, updatedAt: Date.now() })
    const db = await getDB()
    await tx(db, STORE, 'readwrite', s => s.put(record))
    return record
  },

  async delete(id: string): Promise<void> {
    const db = await getDB()
    await tx(db, STORE, 'readwrite', s => s.delete(id))
  },
}
