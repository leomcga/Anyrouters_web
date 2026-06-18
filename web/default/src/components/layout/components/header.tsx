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
import { SidebarTrigger } from '@/components/ui/sidebar'

type HeaderProps = React.HTMLAttributes<HTMLElement>

export function Header({ className, children, ...props }: HeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-40 h-[var(--app-header-height,3rem)] w-full shrink-0 px-3 py-1',
        className
      )}
      {...props}
    >
      {/* Frosted glass pill — same material as the marketing site header so
          entering the console isn't a jarring visual change. */}
      <div className='flex h-full items-center gap-1.5 rounded-2xl border border-black/[0.06] bg-white/80 px-3 shadow-[0_4px_30px_-12px_rgba(30,30,60,0.18)] backdrop-blur-xl sm:gap-2'>
        {/* Mobile only: opens the sidebar drawer. On desktop the toggle lives
            at the top of the sidebar (clearer than sitting beside the logo). */}
        <SidebarTrigger variant='ghost' className='size-8 md:hidden' />
        {children}
      </div>
    </header>
  )
}
