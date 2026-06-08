<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import ApiConfigPanel from '@/components/ApiConfigPanel.vue'
import { settingsService } from '@/services/settingsService'

const router = useRouter()
const settings = ref(settingsService.get())

function save() {
  settingsService.save(settings.value)
  router.push('/')
}
</script>

<template>
  <div class="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col animate-slide-up pb-10">
    <!-- Header -->
    <header class="sticky top-0 z-30 w-full glass-panel border-b border-white/5 px-6 py-4 flex items-center justify-between shadow-lg shadow-black/10">
      <div class="flex items-center gap-3">
        <button @click="router.back()" class="btn-back-arrow">←</button>
        <h1 class="text-xl font-extrabold text-gradient-primary tracking-wide">⚙️ 全局设置</h1>
      </div>
      <button @click="save" class="btn-primary py-2 px-5 text-xs font-bold rounded-xl shadow-lg shadow-purple-500/20 active:scale-95 cursor-pointer">
        💾 保存并返回
      </button>
    </header>

    <div class="max-w-2xl mx-auto w-full p-5 flex flex-col gap-6 mt-4">
      <!-- API Profiles -->
      <section class="glass-card p-5 rounded-2xl border border-white/5 shadow-md">
        <h2 class="font-extrabold text-xs mb-4 text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
          <span>🔌</span> API 服务接入配置
        </h2>
        <ApiConfigPanel />
      </section>

      <!-- 破限提示词 -->
      <section class="glass-card p-5 rounded-2xl border border-white/5 shadow-md flex flex-col gap-2">
        <h2 class="font-extrabold text-xs text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
          <span>🧠</span> 自定义破限提示词 (System Instructions Prefix)
        </h2>
        <p class="text-[10px] text-[var(--text-muted)] font-semibold leading-relaxed">用于 AI 生成角色卡时的系统提示词前缀，留空则默认使用系统预设的高品质角色卡生成指令。</p>
        <textarea v-model="settings.limitlessPrompt" class="input resize-y leading-relaxed font-mono text-xs" rows="6"
          placeholder="留空以使用内置默认系统提示词设定..." />
      </section>

      <!-- Language & Debug Row -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Language -->
        <section class="glass-card p-5 rounded-2xl border border-white/5 shadow-md flex items-center justify-between">
          <div class="min-w-0">
            <h2 class="font-extrabold text-xs text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
              <span>🌐</span> 界面显示语言
            </h2>
            <p class="text-[9px] text-[var(--text-muted)] font-semibold mt-1 truncate">切换应用程序的用户界面语言</p>
          </div>
          <select v-model="settings.language" class="input w-32 cursor-pointer bg-zinc-950 font-semibold text-xs">
            <option value="zh" class="bg-zinc-950">简体中文</option>
            <option value="en" class="bg-zinc-950">English</option>
          </select>
        </section>

        <!-- Debug -->
        <section class="glass-card p-5 rounded-2xl border border-white/5 shadow-md flex items-center">
          <label class="flex items-center gap-3 cursor-pointer select-none">
            <input type="checkbox" v-model="settings.debug" class="accent-[var(--primary)] w-4.5 h-4.5" />
            <div class="flex flex-col">
              <span class="text-xs font-bold text-zinc-200">调试模式</span>
              <span class="text-[9px] text-[var(--text-muted)] font-semibold mt-0.5">在开发者控制台输出详细日志信息</span>
            </div>
          </label>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";

.btn-back-arrow {
  @apply text-xl p-1.5 hover:bg-white/5 rounded-xl text-zinc-400 hover:text-white transition-colors cursor-pointer;
}

.input { @apply w-full bg-zinc-950/45 border border-white/5 text-[var(--text)] px-3.5 py-2.5 rounded-xl outline-none focus:border-[var(--primary)] transition-all focus:bg-zinc-950/80 focus:shadow-[0_0_15px_rgba(168,85,247,0.15)] text-xs md:text-sm; }
.btn-primary { @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white transition-all; }
</style>

