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
      console.log('[Settings Sync] Uploading settings and profiles to server for user:', username)
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      })
      .then(res => {
        if (res.ok) {
          console.log('[Settings Sync] Successfully synced settings and profiles to server.')
        } else {
          console.warn('[Settings Sync] Server returned error status on upload:', res.status)
        }
      })
      .catch(err => console.warn('[Settings Sync] Failed to sync settings to server:', err))
    }
  },

  update(patch: Partial<AppSettings>): void {
    settingsService.save({ ...settingsService.get(), ...patch })
  },
}
