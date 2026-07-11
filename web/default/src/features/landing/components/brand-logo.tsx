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
import type { ImgHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** The shared AnyRouters / AllRouters folded route "A" mark. */
export function BrandMark(props: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      {...props}
      src='/anyrouters-mark-transparent.png'
      className={cn(
        'allrouters-brand-mark-image size-7 object-contain brightness-0',
        props.className
      )}
      alt={props.alt ?? 'AnyRouters'}
    />
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
