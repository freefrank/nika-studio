import { defineStore } from 'pinia'
import { ref } from 'vue'
import { cloneForStorage, openDB, tx } from '@/services/db'

export interface ApiProfile {
  id: string
  name: string
  provider: 'deepseek' | 'gemini' | 'openai-compat' | 'local'
  apiKey: string
  baseUrl?: string
  model: string
  updatedAt: number
}

const DB = 'NikaApiConfigDB'
const STORE = 'profiles'

async function getDB() {
  return openDB(DB, 1, db => {
    if (!db.objectStoreNames.contains(STORE))
      db.createObjectStore(STORE, { keyPath: 'id' })
  })
}

const profileService = {
  async getAll(): Promise<ApiProfile[]> {
    const db = await getDB()
    return tx(db, STORE, 'readonly', s => s.getAll())
  },
  async save(p: ApiProfile): Promise<ApiProfile> {
    const record = cloneForStorage({ ...p, updatedAt: Date.now() })
    const db = await getDB()
    await tx(db, STORE, 'readwrite', s => s.put(record))
    return record
  },
  async delete(id: string): Promise<void> {
    const db = await getDB()
    await tx(db, STORE, 'readwrite', s => s.delete(id))
  },
}

export const useApiConfigStore = defineStore('apiConfig', () => {
  const profiles = ref<ApiProfile[]>([])
  const activeId = ref<string | null>(localStorage.getItem('nika_active_profile'))

  const active = () => profiles.value.find(p => p.id === activeId.value) ?? profiles.value[0] ?? null

  async function load() {
    profiles.value = await profileService.getAll()
  }

  async function save(p: ApiProfile) {
    const saved = await profileService.save(p)
    const idx = profiles.value.findIndex(x => x.id === saved.id)
    if (idx >= 0) profiles.value[idx] = saved
    else profiles.value.push(saved)
  }

  async function remove(id: string) {
    await profileService.delete(id)
    profiles.value = profiles.value.filter(p => p.id !== id)
    if (activeId.value === id) setActive(profiles.value[0]?.id ?? null)
  }

  function setActive(id: string | null) {
    activeId.value = id
    if (id) localStorage.setItem('nika_active_profile', id)
    else localStorage.removeItem('nika_active_profile')
  }

  return { profiles, activeId, active, load, save, remove, setActive }
})
