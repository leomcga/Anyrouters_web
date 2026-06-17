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
import { cn } from '@/lib/utils'

/** The AnyRouters mark — an upward "route" peak, matching the current site. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 32 32'
      className={cn('size-7', className)}
      role='img'
      aria-label='AnyRouters'
    >
      <rect width='32' height='32' rx='9' fill='#1a1a1f' />
      <path
        d='M9 22 16 9l7 13'
        fill='none'
        stroke='#fff'
        strokeWidth='2.6'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

/** Mark + wordmark, used as the top-bar logo. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BrandMark />
      <span className='text-[15px] font-semibold tracking-tight'>
        AnyRouters
      </span>
    </span>
  )
}
