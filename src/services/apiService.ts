import type { ApiConfig } from '@/types'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

async function parseSSE(
  response: Response,
  onChunk: (delta: string) => void,
  isGemini: boolean
): Promise<string> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let full = ''
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') continue
      try {
        const json = JSON.parse(raw)
        const delta = isGemini
          ? (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '')
          : (json.choices?.[0]?.delta?.content ?? '')
        if (delta) { full += delta; onChunk(delta) }
      } catch { /* skip malformed */ }
    }
  }
  return full
}

function openaiUrl(cfg: ApiConfig) {
  const base = cfg.provider === 'deepseek'
    ? 'https://api.deepseek.com/v1'
    : (cfg.baseUrl ?? 'http://localhost:11434/v1')
  return `${base}/chat/completions`
}

export async function streamChat(
  cfg: ApiConfig,
  messages: Message[],
  onChunk: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  if (cfg.provider === 'gemini') {
    const system = messages.find(m => m.role === 'system')
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    const body: Record<string, unknown> = { contents }
    if (system) body.systemInstruction = { parts: [{ text: system.content }] }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:streamGenerateContent?alt=sse&key=${cfg.apiKey}`
    const res = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
    return parseSSE(res, onChunk, true)
  }

  const res = await fetch(openaiUrl(cfg), {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages, stream: true }),
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  return parseSSE(res, onChunk, false)
}

export async function chat(
  cfg: ApiConfig,
  messages: Message[],
  signal?: AbortSignal
): Promise<string> {
  let full = ''
  await streamChat(cfg, messages, d => { full += d }, signal)
  return full
}
