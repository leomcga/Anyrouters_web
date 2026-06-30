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

// Generated videos (Veo) are served from a server-side content proxy
// (/v1/videos/<id>/content) whose upstream task expires after a while — so a
// bare link goes dead on refresh. To keep a generated clip playable across
// refreshes we download the mp4 bytes once and stash them in IndexedDB as a
// Blob, storing only a short `idbvid://<id>` reference in the localStorage chat
// history. We keep at most MAX_VIDEOS (LRU by creation time); videos are much
// larger than images (a few–tens of MB each), so the cap is smaller than the
// image store's — 20 × ~10MB ≈ 200MB, comfortably within IndexedDB limits.

const DB_NAME = 'anyrouters-playground-video'
const STORE = 'videos'
const DB_VERSION = 1
// Keep the most recent N generated videos; prune the oldest beyond this.
const MAX_VIDEOS = 20

export const IDB_VIDEO_PREFIX = 'idbvid://'

interface StoredVideo {
  id: string
  blob: Blob
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

export function isIdbVideoRef(s: string): boolean {
  return typeof s === 'string' && s.startsWith(IDB_VIDEO_PREFIX)
}

/**
 * Download the mp4 at `url` (the content proxy, cookie-authenticated) and store
 * its bytes in IndexedDB. Returns an `idbvid://<id>` reference, or the original
 * url if anything fails (so the bubble still links to the live proxy).
 */
export async function putVideoFromUrl(url: string): Promise<string> {
  const db = await openDB()
  if (!db) return url
  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) return url
    const blob = await res.blob()
    const id = newId()
    const rec: StoredVideo = { id, blob, createdAt: Date.now() }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(rec)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    void pruneOld()
    return IDB_VIDEO_PREFIX + id
  } catch {
    return url
  }
}

/**
 * Resolve an `idbvid://<id>` reference to a playable object URL (or null if
 * missing, e.g. pruned or stored on another device). Callers should revoke the
 * returned URL when done; in practice the player lives for the page session, so
 * we let the browser reclaim it on unload.
 */
export async function getVideoUrl(ref: string): Promise<string | null> {
  if (!isIdbVideoRef(ref)) return ref
  const id = ref.slice(IDB_VIDEO_PREFIX.length)
  const db = await openDB()
  if (!db) return null
  try {
    return await new Promise<string | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(id)
      req.onsuccess = () => {
        const rec = req.result as StoredVideo | undefined
        resolve(rec ? URL.createObjectURL(rec.blob) : null)
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/** Keep only the most recent MAX_VIDEOS; delete the oldest beyond that. */
export async function pruneOld(): Promise<void> {
  const db = await openDB()
  if (!db) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const countReq = store.count()
    countReq.onsuccess = () => {
      const excess = countReq.result - MAX_VIDEOS
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
