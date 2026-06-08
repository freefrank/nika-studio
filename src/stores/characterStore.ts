import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Character } from '@/types'
import { characterService } from '@/services/characterService'

export const useCharacterStore = defineStore('character', () => {
  const characters = ref<Character[]>([])
  const loading = ref(false)

  const sorted = computed(() =>
    [...characters.value].sort((a: Character, b: Character) => b.updatedAt - a.updatedAt)
  )

  async function load() {
    loading.value = true
    characters.value = await characterService.getAll()
    loading.value = false
  }

  async function save(char: Character) {
    const saved = await characterService.save(char)
    const idx = characters.value.findIndex((c: Character) => c.id === saved.id)
    if (idx >= 0) characters.value[idx] = saved
    else characters.value.push(saved)
  }

  async function remove(id: string) {
    await characterService.delete(id)
    characters.value = characters.value.filter((c: Character) => c.id !== id)
  }

  return { characters, sorted, loading, load, save, remove }
})
