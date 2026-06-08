<script setup lang="ts">
import { ref } from 'vue'
import ApiConfigPanel from '@/components/ApiConfigPanel.vue'
import { settingsService } from '@/services/settingsService'
import { useApiConfigStore } from '@/stores/apiConfigStore'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const settings = ref(settingsService.get())
const apiStore = useApiConfigStore()
const syncing = ref(false)

function save() {
  settingsService.save(settings.value)
  emit('close')
}

async function syncCloud() {
  const username = localStorage.getItem('nika_username')
  if (!username) {
    alert('未登录，无法与服务器同步。')
    return
  }

  syncing.value = true

  try {
    console.log(`[Manual Settings Sync] Fetching settings from server for user: ${username}`)
    const res = await fetch(`/api/settings?username=${encodeURIComponent(username)}&_t=${Date.now()}`)
    if (!res.ok) {
      throw new Error(`服务器返回错误状态: ${res.status}`)
    }

    const data = await res.json()
    console.log('[Manual Settings Sync] Server settings received:', data.settings)

    // Sync profiles in IndexedDB & merge
    const serverProfiles = data.settings?.apiProfiles || []
    console.log('[Manual Settings Sync] Merging server profiles into IndexedDB...')
    await apiStore.syncWithServer(serverProfiles)

    // Merge settings
    const serverSettings = data.settings || {}
    const localSettings = settingsService.get()
    const mergedSettings = {
      ...localSettings,
      ...serverSettings,
      // Keep the updated profiles list from IndexedDB after merge
      apiProfiles: apiStore.profiles,
      activeProfileId: apiStore.activeId,
    }

    // Save locally
    settings.value = mergedSettings
    settingsService.save(mergedSettings)
    
    // Trigger update/active check on store (in case active profile details were updated)
    await apiStore.load()

    alert('同步成功！已完成双向同步。')
  } catch (e: any) {
    console.error('[Manual Settings Sync] Error:', e)
    alert(`同步失败: ${e.message || e}`)
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-40 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
    <div class="glass-card border border-white/10 rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl shadow-black/60 relative animate-slide-up">
      <!-- Header -->
      <header class="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-zinc-900/40 shrink-0">
        <div class="flex items-center gap-2">
          <span class="text-xl">⚙️</span>
          <h2 class="text-sm font-extrabold text-gradient-primary tracking-wide">全局设置</h2>
        </div>
        <div class="flex items-center gap-2">
          <button @click="syncCloud" :disabled="syncing" class="btn-secondary py-1.5 px-3 text-[10px] font-bold rounded-xl active:scale-95 cursor-pointer flex items-center gap-1.5 disabled:opacity-50 select-none">
            <span v-if="syncing" class="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin border-purple-400"></span>
            <span>{{ syncing ? '正在同步...' : '🔄 强行同步' }}</span>
          </button>
          <button @click="emit('close')" class="text-zinc-400 hover:text-white text-sm p-1.5 hover:bg-white/5 rounded-xl transition-all cursor-pointer">
            ✕
          </button>
        </div>
      </header>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-6 flex flex-col gap-6 scroll-thin">
        <!-- API Profiles -->
        <section class="flex flex-col gap-3">
          <h3 class="font-extrabold text-[11px] text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
            <span>🔌</span> API 服务接入配置
          </h3>
          <ApiConfigPanel />
        </section>

        <!-- 破限提示词 -->
        <section class="flex flex-col gap-2 border-t border-white/5 pt-5">
          <h3 class="font-extrabold text-[11px] text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
            <span>🧠</span> 自定义破限提示词 (System Instructions Prefix)
          </h3>
          <p class="text-[9px] text-[var(--text-muted)] font-semibold leading-relaxed">用于 AI 生成角色卡时的系统提示词前缀，留空则默认使用系统预设的高品质角色卡生成指令。</p>
          <textarea v-model="settings.limitlessPrompt" class="input resize-y leading-relaxed font-mono text-xs" rows="5"
            placeholder="留空以使用内置默认系统提示词设定..." />
        </section>

        <!-- Language & Debug Row -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-white/5 pt-5">
          <!-- Language -->
          <section class="bg-zinc-950/20 border border-white/5 p-4 rounded-2xl flex items-center justify-between">
            <div class="min-w-0">
              <h3 class="font-extrabold text-[11px] text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                <span>🌐</span> 界面显示语言
              </h3>
              <p class="text-[9px] text-[var(--text-muted)] font-semibold mt-1 truncate">切换应用程序的用户界面语言</p>
            </div>
            <select v-model="settings.language" class="input w-28 cursor-pointer bg-zinc-950 font-semibold text-xs">
              <option value="zh" class="bg-zinc-950">简体中文</option>
              <option value="en" class="bg-zinc-950">English</option>
            </select>
          </section>

          <!-- Debug -->
          <section class="bg-zinc-950/20 border border-white/5 p-4 rounded-2xl flex items-center">
            <label class="flex items-center gap-3 cursor-pointer select-none">
              <input type="checkbox" v-model="settings.debug" class="accent-[var(--primary)] w-4 h-4" />
              <div class="flex flex-col">
                <span class="text-xs font-bold text-zinc-200">调试模式</span>
                <span class="text-[9px] text-[var(--text-muted)] font-semibold mt-0.5">在开发者控制台输出详细日志信息</span>
              </div>
            </label>
          </section>
        </div>
      </div>

      <!-- Footer -->
      <footer class="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/5 bg-zinc-900/20 shrink-0">
        <button @click="emit('close')" class="btn-secondary py-2 px-4 text-xs font-bold rounded-xl select-none">
          取消
        </button>
        <button @click="save" class="btn-primary py-2 px-5 text-xs font-extrabold rounded-xl shadow-lg shadow-purple-500/20 active:scale-95 cursor-pointer select-none">
          💾 保存设置
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";

.input { 
  @apply w-full bg-zinc-950/45 border border-white/5 text-[var(--text)] px-3.5 py-2.5 rounded-xl outline-none focus:border-[var(--primary)] transition-all focus:bg-zinc-950/80 focus:shadow-[0_0_15px_rgba(168,85,247,0.15)] text-xs; 
}
.btn-primary { 
  @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl transition-all active:scale-95 disabled:opacity-50 cursor-pointer; 
}
.btn-secondary { 
  @apply bg-zinc-950/40 hover:bg-zinc-900 border border-white/5 text-purple-400 hover:text-purple-300 transition-all cursor-pointer; 
}

/* Form layout helpers */
.field { @apply flex flex-col gap-1.5; }
.field label { @apply text-[10px] text-zinc-400 font-bold uppercase tracking-wider select-none; }

/* Scrollbar styling */
.scroll-thin {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.05) transparent;
}
.scroll-thin::-webkit-scrollbar {
  width: 4px;
}
.scroll-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scroll-thin::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 9999px;
}
</style>
