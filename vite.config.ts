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
      '/proxy': {
        target: 'http://localhost',
        changeOrigin: true,
        router: (req: any) => {
          const match = req.url?.match(/^\/proxy\/(https?)\/([^/]+)/)
          if (match) {
            const protocol = match[1]
            const host = match[2]
            return `${protocol}://${host}`
          }
          return 'http://localhost'
        },
        rewrite: (path: string) => path.replace(/^\/proxy\/https?\/[^/]+/, ''),
      } as any,
    },
  },
})
