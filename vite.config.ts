import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'url'
import fs from 'fs'
import path from 'path'

const stateFilePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'novel-state.json')

function stateServerPlugin() {
  return {
    name: 'state-server-plugin',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url === '/api/novel-state') {
          if (req.method === 'POST') {
            let body = ''
            req.on('data', (chunk: any) => { body += chunk })
            req.on('end', () => {
              try {
                fs.writeFileSync(stateFilePath, body, 'utf8')
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: true }))
              } catch (err: any) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: err.message }))
              }
            })
            return
          } else if (req.method === 'GET') {
            try {
              if (fs.existsSync(stateFilePath)) {
                const data = fs.readFileSync(stateFilePath, 'utf8')
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(data)
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end('null')
              }
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: err.message }))
            }
            return
          } else if (req.method === 'DELETE') {
            try {
              if (fs.existsSync(stateFilePath)) {
                fs.unlinkSync(stateFilePath)
              }
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true }))
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: err.message }))
            }
            return
          }
        }
        next()
      })
    }
  }
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), stateServerPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['nika.zkx.ca'],
    proxy: {
      '/proxy': {
        target: 'http://localhost',
        changeOrigin: true,
        secure: false,
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
