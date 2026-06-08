<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCharacterStore } from '@/stores/characterStore'
import type { Character } from '@/types'
import { importCard } from '@/services/cardIO'
import NovelView from './NovelView.vue'

const router = useRouter()
const store = useCharacterStore()
const search = ref('')
const filterTag = ref('')
const activeTab = ref<'characters' | 'novel'>('characters')

onMounted(() => store.load())

const filtered = computed(() => {
  let list = store.sorted
  if (search.value) list = list.filter((c: Character) => c.name.toLowerCase().includes(search.value.toLowerCase()))
  if (filterTag.value) list = list.filter((c: Character) => c.tags.includes(filterTag.value))
  return list
})

const allTags = computed(() => [...new Set(store.characters.flatMap((c: Character) => c.tags))])

function newCharacter() { router.push('/editor') }
function editCharacter(id: string) { router.push(`/editor/${id}`) }
function chatWithCharacter(id: string) { router.push(`/chat/${id}`) }

async function toggleFavorite(char: Character) {
  await store.save({ ...char, isFavorite: !char.isFavorite })
}

async function deleteCharacter(char: Character) {
  if (confirm(`删除角色「${char.name}」？`)) await store.remove(char.id)
}

async function importCharacter(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const cardData = await importCard(file)
  if (!cardData) { alert('无法解析角色卡，请确认文件格式正确'); return }
  const char: Character = {
    id: crypto.randomUUID(),
    name: cardData.data.name || file.name.replace(/\.[^.]+$/, ''),
    avatar: cardData.data.avatar,
    tags: cardData.data.tags ?? [],
    isFavorite: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cardData,
  }
  await store.save(char)
  ;(e.target as HTMLInputElement).value = ''
}
</script>

<template>
  <div class="min-h-screen bg-[var(--bg)] text-[var(--text)] animate-slide-up">
    <!-- Header -->
    <div class="flex flex-wrap items-center gap-3 px-5 pt-5 mb-4">
      <h1 class="text-2xl font-extrabold bg-gradient-to-r from-purple-400 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent mr-auto tracking-wide">妮卡角色工作室 Pro</h1>
      <button @click="router.push('/settings')" class="btn-secondary">⚙️ 设置</button>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 px-5 mb-5 border-b border-white/5">
      <button @click="activeTab = 'characters'" class="tab" :class="{ active: activeTab === 'characters' }">🎭 角色库</button>
      <button @click="activeTab = 'novel'" class="tab" :class="{ active: activeTab === 'novel' }">📚 txt转世界书</button>
    </div>

    <!-- ══ Characters Tab ══ -->
    <template v-if="activeTab === 'characters'">
      <div class="px-5">
        <div class="flex flex-wrap gap-3 mb-6">
          <button @click="newCharacter" class="btn-primary">+ 创建角色</button>
          <label class="btn-secondary cursor-pointer">
            📥 导入
            <input type="file" accept=".json,.png" class="hidden" @change="importCharacter" />
          </label>
        </div>
        <div class="flex gap-3 mb-6 flex-wrap">
          <input v-model="search" placeholder="搜索角色..." class="input flex-1 min-w-40" />
          <select v-model="filterTag" class="input w-42 cursor-pointer">
            <option value="" class="bg-zinc-950">全部标签</option>
            <option v-for="tag in allTags" :key="tag" :value="tag" class="bg-zinc-950">{{ tag }}</option>
          </select>
        </div>
      </div>
      <div v-if="store.loading" class="text-center text-[var(--text-muted)] py-20">
        <div class="inline-block w-8 h-8 border-2 border-t-purple-500 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin mb-4"></div>
        <p>加载中...</p>
      </div>
      <div v-else-if="!filtered.length" class="max-w-md mx-auto text-center py-16 px-6 glass-panel rounded-2xl border border-white/5 my-10">
        <div class="w-16 h-16 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">🎭</div>
        <h3 class="text-lg font-semibold mb-2">暂无角色卡</h3>
        <p class="text-sm text-[var(--text-muted)] mb-6">您还没有创建角色卡，或者当前搜索条件未匹配到任何角色。</p>
        <div class="flex justify-center gap-3">
          <button @click="newCharacter" class="btn-primary text-sm">+ 创建角色</button>
          <label class="btn-secondary text-sm cursor-pointer">
            📥 导入角色卡
            <input type="file" accept=".json,.png" class="hidden" @change="importCharacter" />
          </label>
        </div>
      </div>
      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(185px,1fr))] gap-5 px-5 pb-5">
        <div v-for="char in filtered" :key="char.id"
          class="relative rounded-xl overflow-hidden glass-panel border border-white/5 group hover:border-[var(--primary)] hover:-translate-y-1.5 hover:shadow-[0_12px_30px_rgba(168,85,247,0.15)] transition-all duration-300">
          <div class="aspect-[3/4] relative overflow-hidden bg-zinc-950">
            <img v-if="char.avatar" :src="char.avatar" :alt="char.name" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
            <div v-else class="w-full h-full flex items-center justify-center bg-zinc-900/50 text-5xl">🎭</div>
            <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end p-3 gap-2 translate-y-3 group-hover:translate-y-0">
              <button @click="chatWithCharacter(char.id)" class="btn-sm-primary w-full py-1.5 font-semibold text-xs rounded-lg flex items-center justify-center gap-1">💬 聊天</button>
              <button @click="editCharacter(char.id)" class="btn-sm w-full py-1.5 font-medium text-xs rounded-lg flex items-center justify-center gap-1">✏️ 编辑</button>
              <button @click="router.push(`/agent/${char.id}`)" class="btn-sm w-full py-1.5 font-medium text-xs rounded-lg flex items-center justify-center gap-1">🤖 AI助手</button>
            </div>
            <button @click.stop="toggleFavorite(char)"
              class="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 border border-white/10 flex items-center justify-center text-sm transition-all duration-200 backdrop-blur-sm cursor-pointer"
              :class="char.isFavorite ? 'text-yellow-400 hover:text-yellow-300' : 'text-white/40 hover:text-white'">★</button>
          </div>
          <div class="p-3">
            <p class="font-semibold text-sm truncate group-hover:text-purple-400 transition-colors">{{ char.name }}</p>
            <div class="flex flex-wrap gap-1 mt-1.5 min-h-[20px]">
              <span v-for="tag in char.tags.slice(0,3)" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </div>
          <button @click="deleteCharacter(char)"
            class="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/50 border border-white/10 hover:bg-red-600 hover:border-red-500 flex items-center justify-center text-white/50 hover:text-white text-xs opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-sm cursor-pointer">✕</button>
        </div>
      </div>
    </template>

    <!-- ══ Novel Tab ══ -->
    <NovelView v-else :standalone="false" />
  </div>
</template>

<style scoped>
@reference "tailwindcss";
.btn-primary {
  @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow-md shadow-purple-500/10 hover:shadow-purple-500/20 active:scale-95 cursor-pointer;
}
.btn-secondary {
  @apply bg-zinc-900/50 hover:bg-zinc-800/80 text-[var(--text)] px-4 py-2.5 rounded-xl border border-white/5 hover:border-white/10 transition-all active:scale-95 cursor-pointer;
}
.btn-sm {
  @apply bg-white/10 hover:bg-white/20 text-white text-xs px-2 py-1.5 rounded-lg border border-white/5 transition-colors cursor-pointer;
}
.btn-sm-primary {
  @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white text-xs px-2 py-1.5 rounded-lg transition-colors cursor-pointer;
}
.input {
  @apply bg-zinc-900/50 border border-white/5 focus:border-[var(--primary)] text-[var(--text)] px-4 py-2.5 rounded-xl outline-none transition-all focus:bg-zinc-900/80 focus:shadow-[0_0_15px_rgba(168,85,247,0.15)];
}
.tag {
  @apply text-[10px] font-medium bg-purple-500/10 text-purple-300 border border-purple-500/10 px-1.5 py-0.5 rounded-md;
}
.tab {
  @apply px-5 py-2.5 text-sm font-semibold text-[var(--text-muted)] border-b-2 border-transparent hover:text-[var(--text)] transition-all cursor-pointer -mb-px;
}
.tab.active {
  @apply text-[var(--primary)] border-[var(--primary)];
}
</style>
