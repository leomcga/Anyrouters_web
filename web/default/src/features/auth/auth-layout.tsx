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
import { Link } from '@tanstack/react-router'
import { BrandLogo } from '@/features/landing/components/brand-logo'

type AuthLayoutProps = {
  children: React.ReactNode
}

/**
 * Centered glass card on the AnyRouters pastel-mesh backdrop — matches the
 * landing aesthetic (white / soft blue-cyan mesh / clean glass). Brand logo
 * is rendered locally so it never shows the no-config skeleton.
 */
export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className='relative flex min-h-svh items-center justify-center overflow-hidden bg-[#fbfaff] px-4 py-10'>
      {/* pastel mesh backdrop */}
      <div aria-hidden className='pointer-events-none absolute inset-0 -z-10'>
        <div
          className='landing-aurora absolute inset-0'
          style={{
            background: [
              'radial-gradient(45% 45% at 12% 8%, rgba(190,214,255,0.55), transparent 60%)',
              'radial-gradient(45% 45% at 88% 12%, rgba(180,225,255,0.55), transparent 60%)',
              'radial-gradient(55% 50% at 50% 100%, rgba(196,240,236,0.45), transparent 65%)',
              'radial-gradient(35% 35% at 90% 88%, rgba(255,224,210,0.30), transparent 60%)',
            ].join(','),
          }}
        />
        <div className='absolute inset-0 bg-[linear-gradient(to_right,rgba(40,40,80,0.5)_1px,transparent_1px),linear-gradient(to_bottom,rgba(40,40,80,0.5)_1px,transparent_1px)] bg-[size:3.5rem_3.5rem] opacity-[0.025] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,black,transparent_75%)]' />
      </div>

      <div className='w-full max-w-[420px]'>
        <Link
          to='/'
          className='mb-6 flex justify-center transition-opacity hover:opacity-80'
        >
          <BrandLogo />
        </Link>
        <div className='rounded-3xl border border-black/[0.06] bg-white/80 p-8 shadow-[0_30px_80px_-30px_rgba(30,40,80,0.30)] backdrop-blur-xl'>
          {children}
        </div>
      </div>
    </div>
  )
}
