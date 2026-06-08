<script setup lang="ts">
import { ref, computed, onMounted, inject, type Ref } from 'vue'
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
const showSettings = inject<Ref<boolean>>('showSettings')

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

async function cloneCharacter(char: Character) {
  const newName = prompt(`请输入克隆角色的名称：`, `${char.name}_分身`)
  if (newName === null) return
  const nameToUse = newName.trim() || `${char.name}_分身`
  
  const cloned: Character = JSON.parse(JSON.stringify(char))
  cloned.id = crypto.randomUUID()
  cloned.name = nameToUse
  cloned.cardData.data.name = nameToUse
  cloned.createdAt = Date.now()
  cloned.updatedAt = Date.now()
  
  await store.save(cloned)
  await store.load()
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
  <div class="min-h-screen lg:h-screen lg:overflow-hidden bg-[var(--bg)] text-[var(--text)] flex flex-col animate-slide-up pb-6">
    <!-- Header -->
    <header class="sticky top-0 z-30 w-full glass-panel border-b border-white/5 px-6 py-4 flex items-center justify-between shadow-lg shadow-black/10">
      <div class="flex items-center gap-3">
        <span class="text-3xl">🎭</span>
        <h1 class="text-2xl font-extrabold text-gradient-primary tracking-wide">妮卡角色工作室 Pro</h1>
      </div>
      <div class="flex items-center gap-3">
        <button @click="showSettings = true" class="btn-secondary flex items-center gap-2 py-2 px-4 text-xs font-bold rounded-xl">
          <span>⚙️</span> 设置
        </button>
      </div>
    </header>

    <!-- Segmented Control Tabs -->
    <div class="flex justify-center my-8 shrink-0">
      <div class="bg-zinc-950/60 p-1.5 rounded-2xl border border-white/5 flex gap-1">
        <button @click="activeTab = 'characters'" 
          class="px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center gap-2 cursor-pointer"
          :class="activeTab === 'characters' ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/20' : 'text-zinc-400 hover:text-white'">
          <span>🎭</span> 角色库
        </button>
        <button @click="activeTab = 'novel'" 
          class="px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center gap-2 cursor-pointer"
          :class="activeTab === 'novel' ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/20' : 'text-zinc-400 hover:text-white'">
          <span>📚</span> txt转世界书
        </button>
      </div>
    </div>

    <!-- ══ Characters Tab ══ -->
    <template v-if="activeTab === 'characters'">
      <div class="px-6 max-w-7xl mx-auto w-full flex flex-col gap-6 flex-1 lg:overflow-y-auto lg:pr-1 scroll-thin">
        <!-- Controls -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <!-- Action buttons -->
          <div class="flex items-center gap-3">
            <button @click="newCharacter" class="btn-primary flex items-center gap-2">
              <span class="text-lg">+</span> 创建角色
            </button>
            <label class="btn-secondary cursor-pointer flex items-center gap-2">
              <span>📥</span> 导入角色卡
              <input type="file" accept=".json,.png" class="hidden" @change="importCharacter" />
            </label>
          </div>
          
          <!-- Search and filter -->
          <div class="flex items-center gap-3 flex-1 md:max-w-md">
            <div class="relative flex-1">
              <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">🔍</span>
              <input v-model="search" placeholder="搜索角色..." class="input input-icon w-full" />
            </div>
            <div class="relative shrink-0">
              <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">🏷️</span>
              <select v-model="filterTag" class="input input-icon pr-8 cursor-pointer appearance-none bg-zinc-900/50">
                <option value="" class="bg-zinc-950">全部标签</option>
                <option v-for="tag in allTags" :key="tag" :value="tag" class="bg-zinc-950">{{ tag }}</option>
              </select>
              <span class="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none text-[10px]">▼</span>
            </div>
          </div>
        </div>

        <!-- Loading -->
        <div v-if="store.loading" class="text-center text-[var(--text-muted)] py-32 flex-1 flex flex-col items-center justify-center">
          <div class="inline-block w-10 h-10 border-2 border-t-purple-500 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin mb-4"></div>
          <p class="text-sm font-medium">角色库加载中...</p>
        </div>

        <!-- Empty State -->
        <div v-else-if="!filtered.length" class="max-w-md mx-auto text-center py-20 px-8 glass-card rounded-3xl border border-white/5 my-10 animate-fade-in shadow-2xl">
          <div class="w-20 h-20 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-full flex items-center justify-center text-4xl mx-auto mb-6 shadow-inner animate-pulse">🎭</div>
          <h3 class="text-xl font-bold mb-2">暂无角色卡</h3>
          <p class="text-sm text-[var(--text-muted)] mb-8 leading-relaxed">您还没有创建角色卡，或者当前的搜索条件未能匹配到任何角色。</p>
          <div class="flex justify-center gap-3">
            <button @click="newCharacter" class="btn-primary text-sm shadow-lg shadow-purple-500/20">+ 创建角色</button>
            <label class="btn-secondary text-sm cursor-pointer">
              <span>📥</span> 导入角色卡
              <input type="file" accept=".json,.png" class="hidden" @change="importCharacter" />
            </label>
          </div>
        </div>

        <!-- Grid Cards -->
        <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-6 pb-12 animate-fade-in">
          <div v-for="char in filtered" :key="char.id"
            class="relative rounded-2xl overflow-hidden glass-card group hover:border-[var(--primary)] hover:-translate-y-2 hover:shadow-[0_15px_30px_rgba(168,85,247,0.25)] transition-all duration-300 flex flex-col h-[320px]">
            
            <!-- Card Image/Avatar area -->
            <div class="relative flex-1 overflow-hidden bg-zinc-950/40">
              <img v-if="char.avatar" :src="char.avatar" :alt="char.name" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
              <div v-else class="w-full h-full flex items-center justify-center bg-zinc-900/50 text-5xl">🎭</div>
              
              <!-- Hover actions overlay -->
              <div class="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end p-4 gap-2 backdrop-blur-[2px] translate-y-4 group-hover:translate-y-0">
                <button @click="chatWithCharacter(char.id)" class="btn-sm-primary w-full py-2 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-purple-500/20">
                  <span>💬</span> 聊天
                </button>
                <button @click="editCharacter(char.id)" class="btn-sm w-full py-2 font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5">
                  <span>✏️</span> 编辑
                </button>
                <button @click="cloneCharacter(char)" class="btn-sm w-full py-2 font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5">
                  <span>👥</span> 克隆分身
                </button>
                <button @click="router.push(`/agent/${char.id}`)" class="btn-sm w-full py-2 font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5">
                  <span>🤖</span> AI助手
                </button>
              </div>

              <!-- Top right actions (Favorite) -->
              <button @click.stop="toggleFavorite(char)"
                class="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/55 border border-white/10 flex items-center justify-center text-sm transition-all duration-200 backdrop-blur-md cursor-pointer hover:scale-110 active:scale-95"
                :class="char.isFavorite ? 'text-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.3)]' : 'text-white/40 hover:text-white'">
                ★
              </button>

              <!-- Top left actions (Delete) -->
              <button @click="deleteCharacter(char)"
                class="absolute top-3 left-3 w-8 h-8 rounded-full bg-black/55 border border-white/10 hover:bg-red-600 hover:border-red-500 flex items-center justify-center text-white/50 hover:text-white text-xs opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-md cursor-pointer hover:scale-110">
                ✕
              </button>
            </div>

            <!-- Card Info -->
            <div class="p-4 bg-zinc-900/30 border-t border-white/5 flex flex-col gap-1.5 shrink-0">
              <p class="font-bold text-sm truncate text-zinc-100 group-hover:text-purple-400 transition-colors">{{ char.name }}</p>
              <div class="flex flex-wrap gap-1 min-h-[22px]">
                <span v-for="tag in char.tags.slice(0, 2)" :key="tag" class="tag">{{ tag }}</span>
                <span v-if="char.tags.length > 2" class="tag bg-white/5 text-zinc-400 border-0">+{{ char.tags.length - 2 }}</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </template>

    <!-- ══ Novel Tab ══ -->
    <NovelView v-else :standalone="false" class="flex-1 max-w-7xl mx-auto w-full px-6" />
  </div>
</template>

<style scoped>
@reference "tailwindcss";
.btn-primary {
  @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow-md shadow-purple-500/10 hover:shadow-purple-500/20 active:scale-95 cursor-pointer text-xs md:text-sm;
}
.btn-secondary {
  @apply bg-zinc-900/60 hover:bg-zinc-800/80 text-[var(--text)] px-4 py-2.5 rounded-xl border border-white/5 hover:border-white/10 transition-all active:scale-95 cursor-pointer text-xs md:text-sm font-semibold;
}
.btn-sm {
  @apply bg-white/10 hover:bg-white/20 text-white text-xs px-3 py-2 rounded-xl border border-white/5 transition-colors cursor-pointer;
}
.btn-sm-primary {
  @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white text-xs px-3 py-2 rounded-xl transition-colors cursor-pointer;
}
.input {
  @apply bg-zinc-900/40 border border-white/5 focus:border-[var(--primary)] text-[var(--text)] px-4 py-2.5 rounded-xl outline-none transition-all focus:bg-zinc-900/80 focus:shadow-[0_0_15px_rgba(168,85,247,0.15)] text-xs md:text-sm;
}
.input-icon {
  padding-left: 2.5rem !important;
}
.tag {
  @apply text-[10px] font-bold bg-purple-500/10 text-purple-300 border border-purple-500/10 px-2 py-0.5 rounded-md;
}
</style>

