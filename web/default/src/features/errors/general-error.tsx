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
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const FEEDBACK_URL = 'https://github.com/QuantumNous/new-api/issues'

type GeneralErrorProps = React.HTMLAttributes<HTMLDivElement> & {
  minimal?: boolean
  error?: unknown
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const response = (error as Record<string, unknown>).response
  if (typeof response !== 'object' || response === null) return undefined
  const status = (response as Record<string, unknown>).status
  return typeof status === 'number' ? status : undefined
}

// Every deploy renames the hashed JS chunks. A tab still holding the OLD
// index.html then asks for a chunk hash that no longer exists; our SPA fallback
// answers `200` + index.html (not 404), so the browser receives HTML where it
// expected JavaScript and the dynamic import() throws
// ("Failed to fetch dynamically imported module" / "Expected a JavaScript
// module script but the server responded with text/html"). TanStack Router then
// renders this 500 screen. This bites Chrome specifically because it silently
// PRERENDERS the address-bar target from a stale cache (Edge doesn't), which is
// why "only Chrome, and a manual refresh fixes it". We detect that exact failure
// and hard-reload once to pull the fresh index.html + chunks; a sessionStorage
// guard prevents a reload loop when the error is something else.
const CHUNK_RELOAD_GUARD = 'chunk_reload_attempted'

function isChunkLoadError(error: unknown): boolean {
  let msg = ''
  if (error instanceof Error) {
    msg = `${error.name} ${error.message}`
  } else if (typeof error === 'string') {
    msg = error
  } else {
    try {
      msg = String((error as { message?: unknown })?.message ?? '')
    } catch {
      msg = ''
    }
  }
  return (
    /ChunkLoadError/i.test(msg) ||
    /Loading (?:CSS )?chunk [\d]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Expected a JavaScript(?:-or-Wasm)? module script/i.test(msg)
  )
}

function useChunkReloadRecovery(error: unknown): void {
  const isChunkError = isChunkLoadError(error)
  useEffect(() => {
    if (!isChunkError) {
      // A render succeeded without a chunk error — clear the guard so a future
      // deploy can recover again.
      try {
        window.sessionStorage.removeItem(CHUNK_RELOAD_GUARD)
      } catch {
        /* sessionStorage may be unavailable */
      }
      return
    }
    let alreadyTried = false
    try {
      alreadyTried =
        window.sessionStorage.getItem(CHUNK_RELOAD_GUARD) === 'true'
    } catch {
      /* ignore */
    }
    if (alreadyTried) return
    try {
      window.sessionStorage.setItem(CHUNK_RELOAD_GUARD, 'true')
    } catch {
      /* ignore */
    }
    // Reload from the server so the user lands on the working build instead of
    // staring at a 500.
    window.location.reload()
  }, [isChunkError])
}

export function GeneralError({
  className,
  minimal = false,
  error,
}: GeneralErrorProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { history } = useRouter()
  // Auto-recover from stale-chunk failures after a deploy (see note above).
  useChunkReloadRecovery(error)
  const status = getHttpStatus(error)
  const isRateLimited = status === 429
  const title = isRateLimited
    ? t('Too many requests')
    : `${t('Oops! Something went wrong')} ${`:')`}`
  const description = isRateLimited
    ? t('Please wait a moment before trying again.')
    : t('Please try again later.')

  return (
    <div className={cn('h-svh w-full', className)}>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        {!minimal && (
          <h1 className='text-[7rem] leading-tight font-bold'>
            {status ?? 500}
          </h1>
        )}
        <span className='font-medium'>{title}</span>
        <p className='text-muted-foreground text-center'>
          {t('We apologize for the inconvenience.')} <br /> {description}
        </p>
        {!minimal && (
          <p className='text-muted-foreground text-center text-sm'>
            {t('If this keeps happening, please report it on GitHub Issues.')}
          </p>
        )}
        {!minimal && (
          <div className='mt-6 flex flex-wrap justify-center gap-4'>
            <Button variant='outline' onClick={() => history.go(-1)}>
              {t('Go Back')}
            </Button>
            <Button
              variant='outline'
              render={
                <a
                  href={FEEDBACK_URL}
                  target='_blank'
                  rel='noopener noreferrer'
                />
              }
            >
              {t('Report an issue')}
            </Button>
            <Button onClick={() => navigate({ to: '/' })}>
              {t('Back to Home')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
