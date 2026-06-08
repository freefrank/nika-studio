import type { Character } from '@/types'
import { cloneForStorage, openDB, tx } from './db'

const DB = 'NikaCharacterDB'
const STORE = 'characters'

async function getDB() {
  return openDB(DB, 1, db => {
    if (!db.objectStoreNames.contains(STORE))
      db.createObjectStore(STORE, { keyPath: 'id' })
  })
}

export const characterService = {
  async getAll(): Promise<Character[]> {
    const db = await getDB()
    return tx(db, STORE, 'readonly', s => s.getAll())
  },

  async get(id: string): Promise<Character | undefined> {
    const db = await getDB()
    return tx(db, STORE, 'readonly', s => s.get(id))
  },

  async save(char: Character): Promise<Character> {
    const record = cloneForStorage({ ...char, updatedAt: Date.now() })
    const db = await getDB()
    await tx(db, STORE, 'readwrite', s => s.put(record))
    return record
  },

  async delete(id: string): Promise<void> {
    const db = await getDB()
    await tx(db, STORE, 'readwrite', s => s.delete(id))
  },
}
