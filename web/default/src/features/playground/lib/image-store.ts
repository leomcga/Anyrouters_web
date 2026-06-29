/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

// Generated images (Nano Banana / Imagen / gpt-image) come back as multi-MB
// base64 data URIs. localStorage caps at ~5MB, so persisting them there blows
// the quota and corrupts chat history. We keep the heavy bytes in IndexedDB
// (hundreds of MB available, persistent across refresh) and store only a short
// reference token (`idbimg://<id>`) in the localStorage-backed chat history. We
// keep at most MAX_IMAGES (LRU by creation time) so storage never grows
// unbounded — ~100 images × ~2MB ≈ 200MB, well within IndexedDB limits.

const DB_NAME = 'anyrouters-playground'
const STORE = 'images'
const DB_VERSION = 1
// Keep the most recent N generated images; prune the oldest beyond this.
const MAX_IMAGES = 100

export const IDB_IMAGE_PREFIX = 'idbimg://'

interface StoredImage {
  id: string
  dataUrl: string
  createdAt: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' })
          os.createIndex('createdAt', 'createdAt')
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID()
    }
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function isIdbImageRef(s: string): boolean {
  return typeof s === 'string' && s.startsWith(IDB_IMAGE_PREFIX)
}

/** Store a base64 data URL, returns an `idbimg://<id>` reference (or the
 *  original data URL if IndexedDB is unavailable, so nothing breaks). */
export async function putImage(dataUrl: string): Promise<string> {
  const db = await openDB()
  if (!db) return dataUrl
  const id = newId()
  const rec: StoredImage = { id, dataUrl, createdAt: Date.now() }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(rec)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    void pruneOld()
    return IDB_IMAGE_PREFIX + id
  } catch {
    return dataUrl
  }
}

/** Resolve an `idbimg://<id>` reference back to its base64 data URL (null if
 *  missing, e.g. pruned or stored on another device). */
export async function getImage(ref: string): Promise<string | null> {
  if (!isIdbImageRef(ref)) return ref
  const id = ref.slice(IDB_IMAGE_PREFIX.length)
  const db = await openDB()
  if (!db) return null
  try {
    return await new Promise<string | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(id)
      req.onsuccess = () =>
        resolve((req.result as StoredImage | undefined)?.dataUrl ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/** Keep only the most recent MAX_IMAGES; delete the oldest beyond that. */
export async function pruneOld(): Promise<void> {
  const db = await openDB()
  if (!db) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const countReq = store.count()
    countReq.onsuccess = () => {
      const excess = countReq.result - MAX_IMAGES
      if (excess <= 0) return
      let removed = 0
      const curReq = store.index('createdAt').openCursor()
      curReq.onsuccess = () => {
        const cursor = curReq.result
        if (cursor && removed < excess) {
          cursor.delete()
          removed++
          cursor.continue()
        }
      }
    }
  } catch {
    // best-effort cleanup
  }
}
