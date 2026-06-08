import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'url'
import fs from 'fs'
import path from 'path'

const authFilePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server-auth.json')

function loadAuthDb() {
  if (fs.existsSync(authFilePath)) {
    try {
      return JSON.parse(fs.readFileSync(authFilePath, 'utf8'))
    } catch {
      return { users: {} }
    }
  }
  return { users: {} }
}

function saveAuthDb(db: any) {
  fs.writeFileSync(authFilePath, JSON.stringify(db, null, 2), 'utf8')
}

function stateServerPlugin() {
  return {
    name: 'state-server-plugin',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
               const url = new URL(req.url, 'http://localhost')
        const pathname = url.pathname

        if (pathname.startsWith('/api')) {
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User, x-user')
          if (req.method === 'OPTIONS') {
            res.writeHead(204)
            res.end()
            return
          }
        }

        if (pathname.startsWith('/proxy/')) {
          if (!process.env.ENABLE_DEV_PROXY) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Proxy disabled' }))
            return
          }
          const match = pathname.match(/^\/proxy\/(https?)\/([^/]+)(.*)$/)
          if (match) {
            const protocol = match[1]
            const host = match[2]
            const rest = match[3]
            const search = url.search
            
            const targetUrl = `${protocol}://${host}${rest}${search}`
            console.log(`[Proxy Server] Forwarding request to: ${targetUrl}`)
            
            const headers: Record<string, string> = {}
            for (const [key, val] of Object.entries(req.headers)) {
              if (val && !['host', 'connection', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'].includes(key.toLowerCase())) {
                headers[key] = Array.isArray(val) ? val.join(', ') : (val as string)
              }
            }
            
            let body: Buffer | undefined = undefined
            if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
              const chunks: any[] = []
              for await (const chunk of req) {
                chunks.push(chunk)
              }
              body = Buffer.concat(chunks)
            }
            
            try {
              const controller = new AbortController()
              req.on('close', () => controller.abort())
              
              const proxyRes = await fetch(targetUrl, {
                method: req.method,
                headers,
                body,
                signal: controller.signal,
              })
              
              res.writeHead(proxyRes.status, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User',
                'Content-Type': proxyRes.headers.get('content-type') || 'application/json',
              })
              
              if (proxyRes.body) {
                const reader = proxyRes.body.getReader()
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break
                  res.write(value)
                }
              }
              res.end()
            } catch (err: any) {
              console.error(`[Proxy Server] Forwarding error for ${targetUrl}:`, err)
              res.writeHead(502, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Proxy failed', message: err.message }))
            }
            return
          }
        }

        if (pathname === '/api/auth/login' && req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: any) => { body += chunk })
          req.on('end', () => {
            try {
              const { username, password } = JSON.parse(body)
              if (!username || !password) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'Username and password required' }))
                return
              }

              const db = loadAuthDb()
              if (!db.users) db.users = {}

              if (!db.users[username]) {
                // First-use auto registration
                db.users[username] = {
                  password: password,
                  settings: null
                }
                saveAuthDb(db)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: true, settings: null, isNew: true }))
              } else {
                if (db.users[username].password === password) {
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ success: true, settings: db.users[username].settings || null }))
                } else {
                  res.writeHead(401, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ error: '密码错误，请重新输入' }))
                }
              }
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: err.message }))
            }
          })
          return
        }

        if (pathname === '/api/settings') {
          if (req.method === 'POST') {
            let body = ''
            req.on('data', (chunk: any) => { body += chunk })
            req.on('end', () => {
              try {
                const { username, settings } = JSON.parse(body)
                if (!username) {
                  res.writeHead(400, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ error: 'Username required' }))
                  return
                }

                const db = loadAuthDb()
                if (db.users && db.users[username]) {
                  db.users[username].settings = settings
                  saveAuthDb(db)
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ success: true }))
                } else {
                  res.writeHead(404, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ error: 'User not found' }))
                }
              } catch (err: any) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: err.message }))
              }
            })
            return
          } else if (req.method === 'GET') {
            try {
              const username = url.searchParams.get('username')
              if (!username) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'Username required' }))
                return
              }

              const db = loadAuthDb()
              if (db.users && db.users[username]) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ settings: db.users[username].settings || null }))
              } else {
                res.writeHead(404, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'User not found' }))
              }
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: err.message }))
            }
            return
          }
        }

        if (pathname === '/api/novel-state') {
          const username = req.headers['x-user'] || url.searchParams.get('username')
          if (!username) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'User context required' }))
            return
          }

          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(username as string)) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid username' }))
            return
          }
          const dataDir = path.dirname(fileURLToPath(import.meta.url))
          const userStateFilePath = path.resolve(dataDir, `novel-state-${username}.json`)
          if (!userStateFilePath.startsWith(dataDir + path.sep)) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid path' }))
            return
          }

          if (req.method === 'POST') {
            let body = ''
            req.on('data', (chunk: any) => { body += chunk })
            req.on('end', () => {
              try {
                fs.writeFileSync(userStateFilePath, body, 'utf8')
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
              if (fs.existsSync(userStateFilePath)) {
                const data = fs.readFileSync(userStateFilePath, 'utf8')
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
              if (fs.existsSync(userStateFilePath)) {
                fs.unlinkSync(userStateFilePath)
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
  },
})
