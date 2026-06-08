import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'url'
import fs from 'fs'
import path from 'path'
import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'crypto'

const authFilePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server-auth.json')
const SESSION_COOKIE = 'nika_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const MAX_SETTINGS_BODY_BYTES = 2 * 1024 * 1024
const MAX_NOVEL_STATE_BODY_BYTES = 50 * 1024 * 1024
const ALLOW_FIRST_USE_REGISTRATION = process.env.NIKA_ALLOW_FIRST_USE_REGISTRATION === 'true'
const sessions = new Map<string, { username: string; expiresAt: number }>()

interface AuthUser {
  password?: string
  passwordHash?: string
  settings?: unknown
}

interface AuthDb {
  users: Record<string, AuthUser>
}

function loadAuthDb(): AuthDb {
  if (fs.existsSync(authFilePath)) {
    try {
      return JSON.parse(fs.readFileSync(authFilePath, 'utf8'))
    } catch {
      return { users: {} }
    }
  }
  return { users: {} }
}

function saveAuthDb(db: AuthDb) {
  fs.writeFileSync(authFilePath, JSON.stringify(db, null, 2), 'utf8')
}

function sendJson(res: any, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function isValidUsername(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value)
}

function hashPassword(password: string): string {
  const iterations = 210_000
  const salt = randomBytes(16).toString('hex')
  const digest = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex')
  return `pbkdf2_sha256$${iterations}$${salt}$${digest}`
}

function verifyPassword(password: string, encoded: string): boolean {
  const [scheme, iterationsRaw, salt, digest] = encoded.split('$')
  if (scheme !== 'pbkdf2_sha256' || !iterationsRaw || !salt || !digest) return false
  const iterations = Number(iterationsRaw)
  if (!Number.isInteger(iterations) || iterations < 100_000) return false
  const expected = Buffer.from(digest, 'hex')
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, 'sha256')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function getCookie(req: any, name: string): string | null {
  const raw = req.headers.cookie
  if (!raw || typeof raw !== 'string') return null
  for (const part of raw.split(';')) {
    const [key, ...valueParts] = part.trim().split('=')
    if (key === name) return decodeURIComponent(valueParts.join('='))
  }
  return null
}

function createSession(res: any, username: string) {
  const token = `${randomUUID()}${randomBytes(16).toString('hex')}`
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS })
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  )
}

function clearSession(req: any, res: any) {
  const token = getCookie(req, SESSION_COOKIE)
  if (token) sessions.delete(token)
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`)
}

function getSessionUsername(req: any): string | null {
  const token = getCookie(req, SESSION_COOKIE)
  if (!token) return null
  const session = sessions.get(token)
  if (!session) return null
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token)
    return null
  }
  return session.username
}

function requireSession(req: any, res: any): string | null {
  const username = getSessionUsername(req)
  if (!username) {
    sendJson(res, 401, { error: 'Unauthorized' })
    return null
  }
  return username
}

async function readJsonBody(req: any, maxBytes: number): Promise<any> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > maxBytes) throw new Error('Request body too large')
    chunks.push(buf)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

function stateServerPlugin() {
  return {
    name: 'state-server-plugin',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
               const url = new URL(req.url, 'http://localhost')
        const pathname = url.pathname

        if (pathname.startsWith('/api')) {
          res.setHeader('Vary', 'Origin')
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
          if (req.method === 'OPTIONS') {
            res.writeHead(204)
            res.end()
            return
          }
        }

        if (pathname.startsWith('/proxy/')) {
          if (process.env.ENABLE_DEV_PROXY !== 'true') {
            sendJson(res, 404, { error: 'Proxy disabled' })
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
          ;(async () => {
            try {
              const { username, password } = await readJsonBody(req, 16 * 1024)
              if (!isValidUsername(username) || typeof password !== 'string' || !password) {
                sendJson(res, 400, { error: 'Username and password required' })
                return
              }

              const db = loadAuthDb()
              if (!db.users) db.users = {}

              if (!db.users[username]) {
                if (!ALLOW_FIRST_USE_REGISTRATION) {
                  sendJson(res, 403, { error: '账户尚未初始化，请在服务器端创建凭据或临时启用 NIKA_ALLOW_FIRST_USE_REGISTRATION=true。' })
                  return
                }
                db.users[username] = {
                  passwordHash: hashPassword(password),
                  settings: null,
                }
                saveAuthDb(db)
                createSession(res, username)
                sendJson(res, 200, { success: true, settings: null, isNew: true })
                return
              }

              const user = db.users[username]
              let authenticated = false
              if (user.passwordHash) {
                authenticated = verifyPassword(password, user.passwordHash)
              } else if (typeof user.password === 'string' && user.password === password) {
                authenticated = true
                user.passwordHash = hashPassword(password)
                delete user.password
                saveAuthDb(db)
              }

              if (!authenticated) {
                sendJson(res, 401, { error: '密码错误，请重新输入' })
                return
              }

              createSession(res, username)
              sendJson(res, 200, { success: true, settings: user.settings || null })
            } catch (err: any) {
              sendJson(res, 500, { error: err.message })
            }
          })()
          return
        }

        if (pathname === '/api/auth/logout' && req.method === 'POST') {
          clearSession(req, res)
          sendJson(res, 200, { success: true })
          return
        }

        if (pathname === '/api/settings') {
          if (req.method === 'POST') {
            ;(async () => {
              const username = requireSession(req, res)
              if (!username) return
              try {
                const { settings } = await readJsonBody(req, MAX_SETTINGS_BODY_BYTES)
                const db = loadAuthDb()
                if (db.users && db.users[username]) {
                  db.users[username].settings = settings
                  saveAuthDb(db)
                  sendJson(res, 200, { success: true })
                } else {
                  sendJson(res, 404, { error: 'User not found' })
                }
              } catch (err: any) {
                sendJson(res, err.message === 'Request body too large' ? 413 : 500, { error: err.message })
              }
            })()
            return
          } else if (req.method === 'GET') {
            try {
              const username = requireSession(req, res)
              if (!username) return
              const db = loadAuthDb()
              if (db.users && db.users[username]) {
                sendJson(res, 200, { settings: db.users[username].settings || null, username })
              } else {
                sendJson(res, 404, { error: 'User not found' })
              }
            } catch (err: any) {
              sendJson(res, 500, { error: err.message })
            }
            return
          }
        }

        if (pathname === '/api/novel-state') {
          const username = requireSession(req, res)
          if (!username) return
          const dataDir = path.dirname(fileURLToPath(import.meta.url))
          const userStateFilePath = path.resolve(dataDir, `novel-state-${username}.json`)
          if (!userStateFilePath.startsWith(dataDir + path.sep)) {
            sendJson(res, 400, { error: 'Invalid path' })
            return
          }

          if (req.method === 'POST') {
            ;(async () => {
              try {
                const body = await readJsonBody(req, MAX_NOVEL_STATE_BODY_BYTES)
                fs.writeFileSync(userStateFilePath, JSON.stringify(body), 'utf8')
                sendJson(res, 200, { success: true })
              } catch (err: any) {
                sendJson(res, err.message === 'Request body too large' ? 413 : 500, { error: err.message })
              }
            })()
            return
          } else if (req.method === 'GET') {
            try {
              if (fs.existsSync(userStateFilePath)) {
                const data = fs.readFileSync(userStateFilePath, 'utf8')
                sendJson(res, 200, JSON.parse(data))
              } else {
                sendJson(res, 200, null)
              }
            } catch (err: any) {
              sendJson(res, 500, { error: err.message })
            }
            return
          } else if (req.method === 'DELETE') {
            try {
              if (fs.existsSync(userStateFilePath)) {
                fs.unlinkSync(userStateFilePath)
              }
              sendJson(res, 200, { success: true })
            } catch (err: any) {
              sendJson(res, 500, { error: err.message })
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
