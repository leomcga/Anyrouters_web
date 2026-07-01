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

// Persistent cache of code-execution results, keyed by a hash of the exact code.
//
// The run panel auto-runs file-producing code once. An in-memory Map alone stops
// a re-run when switching chats (component remount), but a PAGE REFRESH reloads
// all JS, wiping that Map — so historical file blocks would auto-run in the
// sandbox AGAIN on every refresh (wasted sandbox seconds + double billing). We
// persist completed runs in IndexedDB so a refresh restores the previous result
// and skips the re-run. Keyed by code content, identical blocks share one entry.
//
// Stored value is the plain ExecuteResponse (JSON-serializable: files carry b64
// strings). Capped LRU by createdAt so it can't grow without bound.

import type { ExecuteResponse } from '../types'

const DB_NAME = 'anyrouters-playground-runs'
const STORE = 'runs'
const DB_VERSION = 1
// Keep the most recent N runs; prune the oldest beyond this. Each run holds any
// produced files as base64, so cap modestly.
const MAX_RUNS = 60

export type RunStatus = 'idle' | 'running' | 'done' | 'error'

export interface StoredRun {
  key: string
  result: ExecuteResponse
  status: RunStatus
  errMsg: string
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
          const os = db.createObjectStore(STORE, { keyPath: 'key' })
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

// Small, stable, sync string hash (djb2). We only need a compact collision-
// resistant-enough key for a local cache, not crypto. Prefixed with length to
// further reduce accidental collisions.
export function hashCode(code: string): string {
  let h = 5381
  for (let i = 0; i < code.length; i++) {
    h = ((h << 5) + h + code.charCodeAt(i)) | 0
  }
  return `${code.length}_${(h >>> 0).toString(36)}`
}

/** Load a persisted run by code (null on miss / unavailable). */
export async function loadRun(code: string): Promise<StoredRun | null> {
  const db = await openDB()
  if (!db) return null
  const key = hashCode(code)
  try {
    return await new Promise<StoredRun | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as StoredRun | undefined) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/** Persist a completed run. Errors from transient failures should NOT be saved
 *  by the caller (so a retry / refresh can re-run). */
export async function saveRun(
  code: string,
  result: ExecuteResponse,
  status: RunStatus,
  errMsg: string
): Promise<void> {
  const db = await openDB()
  if (!db) return
  const rec: StoredRun = {
    key: hashCode(code),
    result,
    status,
    errMsg,
    createdAt: Date.now(),
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(rec)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    void pruneOld()
  } catch {
    // best-effort; a cache miss just means a possible re-run later
  }
}

/** Keep only the most recent MAX_RUNS; delete the oldest beyond that. */
export async function pruneOld(): Promise<void> {
  const db = await openDB()
  if (!db) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const countReq = store.count()
    countReq.onsuccess = () => {
      const excess = countReq.result - MAX_RUNS
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
