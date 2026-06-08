import { toRaw } from 'vue'

// Generic IndexedDB wrapper
function openDB(name: string, version: number, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = e => upgrade((e.target as IDBOpenDBRequest).result)
  })
}

function cloneForStorage<T>(value: T): T {
  const seen = new WeakMap<object, unknown>()

  function clone(value: unknown): unknown {
    const raw = toRaw(value)
    if (raw === null || typeof raw !== 'object') return raw
    if (raw instanceof Date) return new Date(raw)
    if (raw instanceof Blob) return raw
    if (raw instanceof ArrayBuffer) return raw.slice(0)
    if (ArrayBuffer.isView(raw)) return raw

    if (seen.has(raw)) return seen.get(raw)

    if (Array.isArray(raw)) {
      const out: unknown[] = []
      seen.set(raw, out)
      for (const item of raw) out.push(clone(item))
      return out
    }

    const out: Record<string, unknown> = {}
    seen.set(raw, out)
    for (const [key, item] of Object.entries(raw)) {
      out[key] = clone(item)
    }
    return out
  }

  return clone(value) as T
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tx<T = any>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export { cloneForStorage, openDB, tx }
