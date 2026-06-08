import { defineStore } from 'pinia'
import { ref } from 'vue'
import { cloneForStorage, openDB, tx } from '@/services/db'
import { settingsService } from '@/services/settingsService'
import type { ApiProfile } from '@/types'

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

  async function syncUp() {
    const allProfiles = await profileService.getAll()
    settingsService.update({
      activeProfileId: activeId.value,
      apiProfiles: allProfiles
    })
  }

  async function load() {
    profiles.value = await profileService.getAll()
    activeId.value = localStorage.getItem('nika_active_profile')
    if (activeId.value) {
      const profile = profiles.value.find(p => p.id === activeId.value)
      if (profile) {
        const currentSettings = settingsService.get()
        if (!currentSettings.activeProfileId || !currentSettings.apiProfiles) {
          settingsService.update({
            activeProfileId: activeId.value,
            apiProfiles: profiles.value,
            apiConfig: {
              provider: profile.provider,
              apiKey: profile.apiKey,
              baseUrl: profile.baseUrl,
              model: profile.model,
              useProxy: profile.useProxy ?? false
            }
          })
        }
      }
    }
  }

  async function save(p: ApiProfile) {
    const saved = await profileService.save(p)
    const idx = profiles.value.findIndex(x => x.id === saved.id)
    if (idx >= 0) profiles.value[idx] = saved
    else profiles.value.push(saved)
    if (activeId.value === saved.id || !activeId.value) {
      await setActive(saved.id)
    } else {
      await syncUp()
    }
  }

  async function remove(id: string) {
    await profileService.delete(id)
    profiles.value = profiles.value.filter(p => p.id !== id)
    if (activeId.value === id) {
      await setActive(profiles.value[0]?.id ?? null)
    } else {
      await syncUp()
    }
  }

  async function setActive(id: string | null) {
    activeId.value = id
    if (id) {
      localStorage.setItem('nika_active_profile', id)
      const profile = profiles.value.find(p => p.id === id)
      if (profile) {
        const allProfiles = await profileService.getAll()
        settingsService.update({
          activeProfileId: id,
          apiProfiles: allProfiles,
          apiConfig: {
            provider: profile.provider,
            apiKey: profile.apiKey,
            baseUrl: profile.baseUrl,
            model: profile.model,
            useProxy: profile.useProxy ?? false
          }
        })
      }
    } else {
      localStorage.removeItem('nika_active_profile')
      const allProfiles = await profileService.getAll()
      settingsService.update({
        activeProfileId: null,
        apiProfiles: allProfiles
      })
    }
  }

  async function syncWithServer(serverProfiles: ApiProfile[]) {
    const local = await profileService.getAll()
    const mergedMap = new Map<string, ApiProfile>()
    
    // Add server profiles
    for (const p of serverProfiles) {
      mergedMap.set(p.id, p)
    }
    
    // Merge with local profiles based on updatedAt
    for (const p of local) {
      const existing = mergedMap.get(p.id)
      if (!existing || p.updatedAt > existing.updatedAt) {
        mergedMap.set(p.id, p)
      }
    }
    
    const merged = Array.from(mergedMap.values())
    
    // Write back to IndexedDB
    for (const p of merged) {
      await profileService.save(p)
    }
    
    profiles.value = merged
    
    // Check if active ID is valid
    const activeExists = activeId.value && profiles.value.some(p => p.id === activeId.value)
    if (!activeExists && profiles.value.length > 0) {
      await setActive(profiles.value[0].id)
    }
  }

  return { profiles, activeId, active, load, save, remove, setActive, syncWithServer }
})
