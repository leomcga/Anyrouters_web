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
import { useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

/**
 * Detect that a newer frontend has been deployed and nudge the user to
 * refresh. We ship many times a day and an SPA tab never swaps its own code:
 * every deploy so far has produced a round of "works for me, broken for the
 * user" reports from stale tabs (frozen composer 07-03 afternoon, group-400
 * the same evening).
 *
 * Mechanism: index.html is served no-cache and its script tag carries the
 * content-hashed bundle name (/static/js/index.<hash>.js). Poll it and compare
 * against the hash this tab is actually running. No backend involvement.
 * Checks run every 5 minutes and immediately when the tab regains visibility —
 * the moment stale tabs come back to life.
 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000
const AUTO_RELOAD_DELAY_MS = 1200
const AUTO_RELOAD_KEY_PREFIX = 'app:auto-reloaded:'
const INDEX_HASH_RE = /static\/js\/index\.([a-f0-9]+)\.js/

// The hash of the bundle THIS tab is running (read once at module load).
const runningHash = (() => {
  const s = document.querySelector(
    'script[src*="/static/js/index."]'
  ) as HTMLScriptElement | null
  return s?.src.match(INDEX_HASH_RE)?.[1] ?? null
})()

// Don't re-nag about a version the user already dismissed.
let dismissedHash: string | null = null

function wasAutoReloaded(hash: string): boolean {
  try {
    return sessionStorage.getItem(AUTO_RELOAD_KEY_PREFIX + hash) === '1'
  } catch {
    return false
  }
}

function markAutoReloaded(hash: string): void {
  try {
    sessionStorage.setItem(AUTO_RELOAD_KEY_PREFIX + hash, '1')
  } catch {
    // sessionStorage can be disabled; at worst the normal toast still appears.
  }
}

async function fetchLiveHash(): Promise<string | null> {
  try {
    const res = await fetch('/', { cache: 'no-store' })
    if (!res.ok) return null
    const html = await res.text()
    return html.match(INDEX_HASH_RE)?.[1] ?? null
  } catch {
    return null // offline/transient — silently try again next tick
  }
}

export function useVersionCheck() {
  const { t } = useTranslation()

  useEffect(() => {
    if (!runningHash) return

    let checking = false
    const check = async () => {
      if (checking || document.hidden) return
      checking = true
      const live = await fetchLiveHash()
      checking = false
      if (live && live !== runningHash && live !== dismissedHash) {
        if (!wasAutoReloaded(live)) {
          markAutoReloaded(live)
          toast.info(t('Updating to the latest version…'), {
            id: 'new-version-auto-reload',
            duration: AUTO_RELOAD_DELAY_MS,
          })
          window.setTimeout(() => {
            window.location.reload()
          }, AUTO_RELOAD_DELAY_MS)
          return
        }

        toast.info(t('A new version is available — refresh to update.'), {
          id: 'new-version',
          duration: Infinity,
          action: {
            label: t('Refresh'),
            onClick: () => window.location.reload(),
          },
          onDismiss: () => {
            dismissedHash = live
          },
        })
      }
    }

    const timer = setInterval(check, CHECK_INTERVAL_MS)
    const onVisible = () => {
      if (!document.hidden) void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [t])
}
