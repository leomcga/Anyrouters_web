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
//
// MEMORY: images are stored as Blobs and resolved to short-lived object URLs
// (URL.createObjectURL), NOT base64 strings. A base64 data URI keeps the whole
// multi-MB payload resident in the JS heap (and it's ~33% larger than the raw
// bytes) for every visible history image — a handful of them plus a long chat
// was enough to OOM-kill the renderer ("此页存在问题 / 错误代码: 5"). An object
// URL points at the Blob the browser holds off-heap, so the heap only carries a
// short URL string. This mirrors how video-store.ts already works. Callers must
// revoke the URL when the <img> unmounts (see releaseImageUrl / GeneratedImage).

const DB_NAME = 'anyrouters-playground'
const STORE = 'images'
// v2: values are stored as { blob } instead of { dataUrl }. onupgradeneeded
// creates the same store shape; old v1 base64 records are still readable (see
// getImageUrl's dataUrl fallback), so no destructive migration is needed.
const DB_VERSION = 2
// Keep the most recent N generated images; prune the oldest beyond this.
const MAX_IMAGES = 100

export const IDB_IMAGE_PREFIX = 'idbimg://'

interface StoredImage {
  id: string
  // New records store the raw bytes as a Blob (off-heap). Legacy v1 records
  // stored a base64 data URL string in `dataUrl`; both are handled on read.
  blob?: Blob
  dataUrl?: string
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

// Convert a base64 data URL to a Blob without inflating the whole thing through
// intermediate strings more than necessary (single atob + one Uint8Array).
function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const comma = dataUrl.indexOf(',')
    if (comma < 0) return null
    const header = dataUrl.slice(0, comma)
    const mime = header.match(/data:([^;]+)/)?.[1] || 'image/png'
    const bin = atob(dataUrl.slice(comma + 1))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  } catch {
    return null
  }
}

/** Store a base64 data URL as a Blob, returns an `idbimg://<id>` reference (or
 *  the original data URL if IndexedDB is unavailable, so nothing breaks). */
export async function putImage(dataUrl: string): Promise<string> {
  const db = await openDB()
  if (!db) return dataUrl
  const blob = dataUrlToBlob(dataUrl)
  if (!blob) return dataUrl
  const id = newId()
  const rec: StoredImage = { id, blob, createdAt: Date.now() }
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

/** Resolve an `idbimg://<id>` reference to a playable object URL (or null if
 *  missing, e.g. pruned or stored on another device). The caller MUST revoke
 *  the returned URL when done (releaseImageUrl) so the Blob can be reclaimed.
 *  A non-idbimg input (a live-session base64 data URL) is returned unchanged. */
export async function getImageUrl(ref: string): Promise<string | null> {
  if (!isIdbImageRef(ref)) return ref
  const id = ref.slice(IDB_IMAGE_PREFIX.length)
  const db = await openDB()
  if (!db) return null
  try {
    return await new Promise<string | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(id)
      req.onsuccess = () => {
        const rec = req.result as StoredImage | undefined
        if (!rec) {
          resolve(null)
          return
        }
        if (rec.blob) {
          resolve(URL.createObjectURL(rec.blob))
          return
        }
        // Legacy v1 record: a base64 data URL. Convert to a Blob object URL so
        // the heap doesn't carry the base64 string; fall back to the raw data
        // URL only if conversion fails.
        if (rec.dataUrl) {
          const blob = dataUrlToBlob(rec.dataUrl)
          resolve(blob ? URL.createObjectURL(blob) : rec.dataUrl)
          return
        }
        resolve(null)
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/** Revoke an object URL returned by getImageUrl. No-ops for non-blob URLs (e.g.
 *  a passed-through data URL), which have nothing to reclaim. */
export function releaseImageUrl(url: string | null | undefined): void {
  if (url && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      // already revoked / invalid
    }
  }
}

/** Resolve an `idbimg://<id>` reference back to a base64 data URL. Needed by
 *  code paths that must have the raw bytes as a string (image editing sends the
 *  picture back to the model as an image_url data URI; copy-to-clipboard). This
 *  DOES pull the payload into the heap, so use getImageUrl for display. */
export async function getImage(ref: string): Promise<string | null> {
  if (!isIdbImageRef(ref)) return ref
  const id = ref.slice(IDB_IMAGE_PREFIX.length)
  const db = await openDB()
  if (!db) return null
  try {
    const rec = await new Promise<StoredImage | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(id)
      req.onsuccess = () => resolve((req.result as StoredImage | undefined) ?? null)
      req.onerror = () => resolve(null)
    })
    if (!rec) return null
    if (rec.dataUrl) return rec.dataUrl
    if (rec.blob) return await blobToDataUrl(rec.blob)
    return null
  } catch {
    return null
  }
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const fr = new FileReader()
    fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null)
    fr.onerror = () => resolve(null)
    fr.readAsDataURL(blob)
  })
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
