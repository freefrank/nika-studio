import type { AppSettings } from '@/types'

const KEY = 'nika_settings'

const defaults: AppSettings = {
  apiConfig: { provider: 'deepseek', apiKey: '', model: 'deepseek-chat', useProxy: false },
  language: 'zh',
  debug: false,
  limitlessPrompt: '',
}

export const settingsService = {
  get(): AppSettings {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults }
    } catch {
      return { ...defaults }
    }
  },

  save(settings: AppSettings): void {
    localStorage.setItem(KEY, JSON.stringify(settings))
    const username = localStorage.getItem('nika_username')
    if (username) {
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, settings })
      }).catch(err => console.warn('Failed to sync settings to server:', err))
    }
  },

  update(patch: Partial<AppSettings>): void {
    settingsService.save({ ...settingsService.get(), ...patch })
  },
}
