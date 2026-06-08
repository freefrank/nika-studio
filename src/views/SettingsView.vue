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
  <div class="min-h-screen bg-[var(--bg)] text-[var(--text)] animate-slide-up">
    <div class="flex items-center gap-3 px-4 py-3 bg-[var(--bg-2)]/80 backdrop-blur-md border-b border-white/5 shrink-0 z-20 sticky top-0">
      <button @click="router.back()" class="text-xl hover:text-[var(--primary)] transition-colors cursor-pointer">←</button>
      <span class="font-bold text-sm md:text-base flex-1 tracking-wide">⚙️ 全局设置</span>
      <button @click="save" class="btn-primary py-1.5 px-4 text-xs font-bold rounded-lg shadow-md shadow-purple-500/10 hover:shadow-purple-500/20 active:scale-95 cursor-pointer">保存</button>
    </div>

    <div class="max-w-2xl mx-auto p-5 flex flex-col gap-6">
      <!-- API Profiles -->
      <section class="glass-panel p-5 rounded-2xl border border-white/5 shadow-sm">
        <h2 class="font-semibold mb-4 text-purple-400">API 配置</h2>
        <ApiConfigPanel />
      </section>

      <!-- 破限提示词 -->
      <section class="glass-panel p-5 rounded-2xl border border-white/5 shadow-sm">
        <h2 class="font-semibold mb-2 text-purple-400">自定义破限提示词</h2>
        <p class="text-xs text-[var(--text-muted)] mb-3">用于 AI 生成角色卡时的系统提示词前缀（留空使用内置默认值）</p>
        <textarea v-model="settings.limitlessPrompt" class="input resize-y leading-relaxed" rows="6"
          placeholder="留空使用内置默认提示词..." />
      </section>

      <!-- Language -->
      <section class="glass-panel p-5 rounded-2xl border border-white/5 shadow-sm flex items-center justify-between">
        <div>
          <h2 class="font-semibold text-purple-400">界面语言</h2>
          <p class="text-xs text-[var(--text-muted)] mt-1">切换应用界面的主要显示语言</p>
        </div>
        <select v-model="settings.language" class="input w-40 cursor-pointer">
          <option value="zh" class="bg-zinc-950">中文</option>
          <option value="en" class="bg-zinc-950">English</option>
        </select>
      </section>

      <!-- Debug -->
      <section class="glass-panel p-5 rounded-2xl border border-white/5 shadow-sm">
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" v-model="settings.debug" class="accent-[var(--primary)] w-4 h-4" />
          <span class="text-sm font-medium">开启调试模式（控制台日志）</span>
        </label>
      </section>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";
.input { @apply w-full bg-zinc-900/50 border border-white/5 text-[var(--text)] px-3.5 py-2.5 rounded-xl outline-none focus:border-[var(--primary)] transition-all focus:bg-zinc-900/80 focus:shadow-[0_0_15px_rgba(168,85,247,0.15)] text-sm; }
.btn-primary { @apply bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white transition-all; }
h2 { @apply text-xs uppercase tracking-wider; }
</style>
