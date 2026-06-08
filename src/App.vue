<script setup lang="ts">
import { ref, onMounted, provide } from 'vue'
import pkg from '../package.json'
import { useApiConfigStore } from '@/stores/apiConfigStore'
import SettingsModal from '@/components/SettingsModal.vue'

const showSettings = ref(false)
provide('showSettings', showSettings)

const isLoggedIn = ref(false)
const currentUsername = ref('')
const username = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)

const syncSettings = async (user: string) => {
  console.log(`[Settings Sync] Fetching settings from server for user: ${user}`)
  try {
    // Add cache buster query parameter to bypass potential reverse-proxy/browser cache
    const res = await fetch(`/api/settings?username=${encodeURIComponent(user)}&_t=${Date.now()}`)
    if (res.ok) {
      const data = await res.json()
      if (data.settings) {
        console.log('[Settings Sync] Settings downloaded successfully:', data.settings)
        localStorage.setItem('nika_settings', JSON.stringify(data.settings))
        
        if (data.settings.activeProfileId !== undefined) {
          if (data.settings.activeProfileId) {
            localStorage.setItem('nika_active_profile', data.settings.activeProfileId)
          } else {
            localStorage.removeItem('nika_active_profile')
          }
        }
        
        if (data.settings.apiProfiles) {
          console.log('[Settings Sync] Synchronizing API profiles to IndexedDB...')
          const apiConfigStore = useApiConfigStore()
          await apiConfigStore.syncWithServer(data.settings.apiProfiles)
        }
        console.log('[Settings Sync] Local synchronization finished.')
      } else {
        console.log('[Settings Sync] No settings returned by server.')
      }
    } else {
      console.warn(`[Settings Sync] Server returned non-ok status: ${res.status}`)
    }
  } catch (e) {
    console.warn('[Settings Sync] Error fetching settings:', e)
  }
}

onMounted(() => {
  const storedUser = localStorage.getItem('nika_username')
  if (storedUser) {
    currentUsername.value = storedUser
    isLoggedIn.value = true
    syncSettings(storedUser)
  }
})

const handleLogin = async () => {
  errorMsg.value = ''
  loading.value = true
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value.trim(), password: password.value })
    })
    
    const data = await res.json()
    if (res.ok && data.success) {
      localStorage.setItem('nika_username', username.value.trim())
      currentUsername.value = username.value.trim()
      
      const localSettingsRaw = localStorage.getItem('nika_settings')
      if (data.settings) {
        // Server has settings: sync down
        localStorage.setItem('nika_settings', JSON.stringify(data.settings))
        if (data.settings.activeProfileId !== undefined) {
          if (data.settings.activeProfileId) {
            localStorage.setItem('nika_active_profile', data.settings.activeProfileId)
          } else {
            localStorage.removeItem('nika_active_profile')
          }
        }
        if (data.settings.apiProfiles) {
          const apiConfigStore = useApiConfigStore()
          await apiConfigStore.syncWithServer(data.settings.apiProfiles)
        }
      } else if (localSettingsRaw) {
        // Server has no settings, but client has local settings: sync up (migrate to server)
        try {
          const parsed = JSON.parse(localSettingsRaw)
          // Include local IndexedDB profiles & active profile ID in migration
          const apiConfigStore = useApiConfigStore()
          await apiConfigStore.load()
          parsed.apiProfiles = apiConfigStore.profiles
          parsed.activeProfileId = apiConfigStore.activeId
          
          await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username.value.trim(), settings: parsed })
          })
          console.log('[Settings Sync] Successfully migrated local settings and profiles to server.')
        } catch (e) {
          console.warn('[Settings Sync] Failed to upload existing settings during login migration:', e)
        }
      }
      
      isLoggedIn.value = true
      // Reload page to re-initialize store values with new credentials
      window.location.reload()
    } else {
      errorMsg.value = data.error || '登录验证失败'
    }
  } catch (err: any) {
    errorMsg.value = '服务器连接失败，请检查服务状态'
  } finally {
    loading.value = false
  }
}

const logout = () => {
  localStorage.removeItem('nika_username')
  window.location.reload()
}
</script>


<template>
  <div v-if="!isLoggedIn" class="fixed inset-0 z-50 flex items-center justify-center bg-[#09090b] overflow-hidden font-sans select-none">
    <!-- Glowing background decorative orbs -->
    <div class="absolute top-1/4 left-1/4 w-[40vw] h-[40vw] bg-purple-500/5 rounded-full blur-[120px] animate-pulse duration-[8000ms] pointer-events-none"></div>
    <div class="absolute bottom-1/4 right-1/4 w-[40vw] h-[40vw] bg-pink-500/5 rounded-full blur-[120px] animate-pulse duration-[12000ms] pointer-events-none"></div>
    
    <div class="w-full max-w-sm px-6">
      <div class="glass-card rounded-3xl p-8 border border-white/5 bg-[#09090b]/20 backdrop-blur-2xl shadow-2xl flex flex-col gap-6 text-center animate-fade-in relative z-10 shadow-black/50">
        <!-- Logo -->
        <div class="flex flex-col gap-2 items-center">
          <span class="text-5xl transform hover:scale-110 transition-transform duration-300 select-none">🔮</span>
          <h1 class="text-2xl font-black bg-gradient-to-r from-purple-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent tracking-wide mt-1">
            NIKA STUDIO
          </h1>
          <p class="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-0.5">智能创作与设定工坊</p>
        </div>
        
        <!-- Form -->
        <form @submit.prevent="handleLogin" class="flex flex-col gap-4 text-left">
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] text-zinc-400 font-bold uppercase tracking-wider select-none">用户名</label>
            <input 
              v-model="username" 
              type="text" 
              required
              placeholder="输入用户名" 
              class="input bg-zinc-950/40 border border-white/5 text-zinc-100 px-4 py-3 rounded-2xl outline-none focus:border-purple-500 transition-all focus:bg-zinc-900/60 focus:shadow-[0_0_15px_rgba(168,85,247,0.1)] text-xs"
            />
          </div>
          
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] text-zinc-400 font-bold uppercase tracking-wider select-none">密码</label>
            <input 
              v-model="password" 
              type="password" 
              required
              placeholder="输入密码" 
              class="input bg-zinc-950/40 border border-white/5 text-zinc-100 px-4 py-3 rounded-2xl outline-none focus:border-purple-500 transition-all focus:bg-zinc-900/60 focus:shadow-[0_0_15px_rgba(168,85,247,0.1)] text-xs"
            />
          </div>

          <!-- Error message -->
          <div v-if="errorMsg" class="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 px-3.5 py-2 rounded-xl font-medium animate-shake flex items-center gap-1.5">
            <span>⚠️</span> {{ errorMsg }}
          </div>

          <!-- Submit Button -->
          <button 
            type="submit" 
            :disabled="loading"
            class="btn-primary w-full py-3 rounded-2xl text-xs font-extrabold shadow-lg shadow-purple-500/15 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white transition-all active:scale-95 disabled:opacity-50 cursor-pointer flex justify-center items-center gap-2 mt-2"
          >
            <span v-if="loading" class="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            <span>{{ loading ? '验证凭证中...' : '开启创作之旅' }}</span>
          </button>
        </form>

        <!-- Tooltip -->
        <p class="text-[9px] leading-relaxed text-zinc-500 px-1 select-none border-t border-white/5 pt-4 mt-2">
          💡 <strong>首次登录提示</strong>：本系统采用自动发现机制。如果是首次使用该账户名，直接输入密码即可登录，后台会自动注册为您的唯一登录凭证。
        </p>
      </div>
    </div>
  </div>

  <div v-else class="h-screen w-screen overflow-hidden relative">
    <RouterView />
    
    <!-- Floating Settings Bubble Button -->
    <button @click="showSettings = !showSettings" 
      class="fixed bottom-3 right-16 z-40 w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 border border-white/10 flex items-center justify-center text-xs shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 hover:scale-110 active:scale-95 transition-all cursor-pointer select-none"
      title="全局设置">
      ⚙️
    </button>

    <!-- Floating Settings Modal Overlay -->
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
    
    <!-- Floating Version Badge -->
    <div class="fixed bottom-3 right-3 z-50 bg-zinc-950/70 border border-white/10 backdrop-blur-md px-2.5 py-0.5 rounded-full text-[10px] font-medium text-zinc-400 select-none pointer-events-none tracking-wider shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
      v{{ pkg.version }}
    </div>

    <!-- Floating Logout Button -->
    <button @click="logout" class="fixed bottom-3 left-3 z-50 bg-zinc-950/70 border border-white/10 hover:bg-red-500/10 hover:border-red-500/30 backdrop-blur-md px-2.5 py-1 rounded-full text-[10px] font-bold text-zinc-400 hover:text-red-400 select-none cursor-pointer tracking-wider shadow-md transition-all">
      🚪 退出登录 ({{ currentUsername }})
    </button>
  </div>
</template>

<style>
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
  20%, 40%, 60%, 80% { transform: translateX(4px); }
}
.animate-shake {
  animation: shake 0.4s ease-in-out;
}
.glass-card {
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
}
</style>
