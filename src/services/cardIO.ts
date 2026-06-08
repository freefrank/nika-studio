import pako from 'pako'
import type { Character, CharacterData } from '@/types'

// ---- PNG chunk helpers ----
function readUint32(buf: Uint8Array, offset: number) {
  return (buf[offset] << 24 | buf[offset+1] << 16 | buf[offset+2] << 8 | buf[offset+3]) >>> 0
}

function writeUint32(buf: Uint8Array, offset: number, val: number) {
  buf[offset]   = (val >>> 24) & 0xff
  buf[offset+1] = (val >>> 16) & 0xff
  buf[offset+2] = (val >>> 8)  & 0xff
  buf[offset+3] =  val         & 0xff
}

const CRC32_TABLE = new Uint32Array(256)
for (let i = 0; i < CRC32_TABLE.length; i++) {
  let crc = i
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
  }
  CRC32_TABLE[i] = crc >>> 0
}

function updateCrc32(crc: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return crc >>> 0
}

function pngChunkCrc(typeBytes: Uint8Array, data: Uint8Array): number {
  let crc = 0xffffffff
  crc = updateCrc32(crc, typeBytes)
  crc = updateCrc32(crc, data)
  return (crc ^ 0xffffffff) >>> 0
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    let segment = ''
    for (let j = 0; j < chunk.length; j++) {
      segment += String.fromCharCode(chunk[j])
    }
    binary += segment
  }
  return btoa(binary)
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4E &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0D &&
    bytes[5] === 0x0A &&
    bytes[6] === 0x1A &&
    bytes[7] === 0x0A
}

function convertToPngBytes(url: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas context failed')); return }
      ctx.drawImage(img, 0, 0)
      const dataUrl = canvas.toDataURL('image/png')
      const b64 = dataUrl.split(',')[1]
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      resolve(bytes)
    }
    img.onerror = () => reject(new Error('Failed to load image for PNG conversion'))
    img.src = url
  })
}

function extractCharaFromPng(bytes: Uint8Array): string | null {
  if (!isPng(bytes)) return null
  let i = 8 // skip PNG signature
  while (i < bytes.length) {
    const length = readUint32(bytes, i)
    const type = String.fromCharCode(bytes[i+4], bytes[i+5], bytes[i+6], bytes[i+7])
    if (type === 'tEXt') {
      const data = bytes.slice(i+8, i+8+length)
      const nullIdx = data.indexOf(0)
      const key = new TextDecoder().decode(data.slice(0, nullIdx))
      if (key === 'chara') {
        return new TextDecoder().decode(data.slice(nullIdx+1))
      }
    }
    i += 12 + length
  }
  return null
}

function buildTextChunk(key: string, value: string): Uint8Array {
  const enc = new TextEncoder()
  const keyBytes = enc.encode(key)
  const valBytes = enc.encode(value)
  const data = new Uint8Array(keyBytes.length + 1 + valBytes.length)
  data.set(keyBytes)
  data[keyBytes.length] = 0
  data.set(valBytes, keyBytes.length + 1)

  const chunk = new Uint8Array(12 + data.length)
  writeUint32(chunk, 0, data.length)
  const typeBytes = new Uint8Array([0x74, 0x45, 0x58, 0x74]) // tEXt
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  writeUint32(chunk, 8 + data.length, pngChunkCrc(typeBytes, data))
  return chunk
}

function injectChunkBeforeIEND(pngBytes: Uint8Array, chunk: Uint8Array): Uint8Array {
  // Find IEND offset
  let iendOffset = pngBytes.length - 12
  for (let i = 8; i < pngBytes.length; ) {
    const length = readUint32(pngBytes, i)
    const type = String.fromCharCode(pngBytes[i+4], pngBytes[i+5], pngBytes[i+6], pngBytes[i+7])
    if (type === 'IEND') { iendOffset = i; break }
    i += 12 + length
  }
  const out = new Uint8Array(pngBytes.length + chunk.length)
  out.set(pngBytes.slice(0, iendOffset))
  out.set(chunk, iendOffset)
  out.set(pngBytes.slice(iendOffset), iendOffset + chunk.length)
  return out
}

// ---- Public API ----

export async function importCard(file: File): Promise<CharacterData | null> {
  try {
    if (file.name.endsWith('.json')) {
      const text = await file.text()
      const parsed = JSON.parse(text)
      // Handle both raw CharacterData and {char: CharacterData} exports
      return (parsed.spec && parsed.data) ? parsed : parsed.char ?? null
    }
    if (file.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      const b64 = extractCharaFromPng(bytes)
      if (!b64) return null
      // base64 -> inflate -> JSON
      const compressed = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      const json = pako.inflate(compressed, { to: 'string' })
      return JSON.parse(json)
    }
  } catch (e) {
    console.error('importCard error', e)
  }
  return null
}

export function exportCardAsJson(char: Character): void {
  const blob = new Blob([JSON.stringify(char.cardData, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${char.name}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

// Export worldbook as standalone Lorebook JSON (TavernAI format)
export function exportLorebook(char: Character): void {
  const wb = char.cardData.data.character_book
  if (!wb?.entries?.length) { alert('该角色没有世界书条目'); return }
  const lorebook = {
    name: wb.name || char.name,
    entries: wb.entries.map((e, i) => ({
      id: i, keys: e.keys, content: e.content,
      enabled: e.enabled, comment: e.comment,
      insertion_order: e.insertion_order ?? i,
      position: e.position ?? 'before_char',
    })),
  }
  const blob = new Blob([JSON.stringify(lorebook, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${char.name}_lorebook.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function exportCardAsPng(char: Character): Promise<void> {
  // Get base PNG bytes
  let pngBytes: Uint8Array
  if (char.avatar) {
    try {
      const res = await fetch(char.avatar)
      const buf = await res.arrayBuffer()
      const bytes = new Uint8Array(buf)
      if (isPng(bytes)) {
        pngBytes = bytes
      } else {
        pngBytes = await convertToPngBytes(char.avatar)
      }
    } catch (e) {
      console.warn('Direct fetch failed, trying canvas conversion', e)
      pngBytes = await convertToPngBytes(char.avatar)
    }
  } else {
    // 128x128 placeholder canvas
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#2d2d2d'
    ctx.fillRect(0, 0, 128, 128)
    ctx.font = '64px serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
    ctx.fillText('🎭', 64, 96)
    const dataUrl = canvas.toDataURL('image/png')
    const b64 = dataUrl.split(',')[1]
    pngBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  }

  // Build tEXt chunk
  const json = JSON.stringify(char.cardData)
  const compressed = pako.deflate(new TextEncoder().encode(json))
  const b64 = bytesToBase64(compressed)
  const chunk = buildTextChunk('chara', b64)
  const out = injectChunkBeforeIEND(pngBytes, chunk)

  const blob = new Blob([out.buffer as ArrayBuffer], { type: 'image/png' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${char.name}.png`
  a.click()
  URL.revokeObjectURL(a.href)
}
