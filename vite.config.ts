import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'url'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: {
      '/proxy-cherry': {
        target: 'https://open.cherryin.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-cherry/, ''),
      },
    },
  },
})
