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
import { useTranslation } from 'react-i18next'
import { ArrowRight, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PublicLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { BrandLogo } from './components/brand-logo'
import { type LandingCopy, landingContent } from './content'

// Brand indigo, applied locally so the global theme tokens stay untouched
// for now (a deliberate, separately-verified change later).
const PRIMARY =
  'bg-[#0e9e66] text-white shadow-[0_10px_34px_-8px_rgba(14,158,102,0.65)] hover:bg-[#0b7d51] hover:shadow-[0_14px_40px_-8px_rgba(14,158,102,0.7)]'
const GRADIENT =
  'bg-gradient-to-r from-[#0e9e66] via-[#2ecc71] to-[#39c2b0] bg-clip-text text-transparent'
const GLASS =
  'border border-white/60 bg-white/70 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]'

function useLandingCopy(): LandingCopy {
  const { i18n } = useTranslation()
  const lang = i18n.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  return landingContent[lang]
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className='text-[11px] font-bold tracking-[0.18em] text-[#0e9e66] uppercase'>
      {children}
    </p>
  )
}

/* A soft blurred gradient orb used to build the aurora backdrop. */
function Orb({
  className,
  color,
  delay = '0s',
}: {
  className?: string
  color: string
  delay?: string
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'landing-aurora pointer-events-none absolute rounded-full blur-3xl',
        className
      )}
      style={{ background: color, animationDelay: delay }}
    />
  )
}

/* Page-wide dreamy backdrop: a faint tinted wash + drifting orbs + grid. */
function PageAurora() {
  return (
    <div
      aria-hidden
      className='pointer-events-none fixed inset-0 -z-10 overflow-hidden'
    >
      <div
        className='absolute inset-0'
        style={{
          background:
            'linear-gradient(180deg, #f7f4ec 0%, #fdfbf6 28%, #ffffff 58%)',
        }}
      />
      <Orb
        color='radial-gradient(circle, rgba(14,158,102,0.45), transparent 65%)'
        className='-top-40 -left-28 h-[34rem] w-[34rem] opacity-60'
      />
      <Orb
        color='radial-gradient(circle, rgba(57,194,176,0.40), transparent 65%)'
        className='-top-32 right-[-10rem] h-[32rem] w-[32rem] opacity-50'
        delay='-6s'
      />
      <Orb
        color='radial-gradient(circle, rgba(46,204,113,0.28), transparent 65%)'
        className='top-[42%] left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 opacity-40'
        delay='-3s'
      />
      {/* faint grid, fading out radially */}
      <div className='absolute inset-0 bg-[linear-gradient(to_right,rgba(14,158,102,0.5)_1px,transparent_1px),linear-gradient(to_bottom,rgba(14,158,102,0.5)_1px,transparent_1px)] bg-[size:3.5rem_3.5rem] opacity-[0.04] [mask-image:radial-gradient(ellipse_70%_50%_at_50%_0%,black,transparent_75%)]' />
    </div>
  )
}

/* ── Hero ─────────────────────────────────────────────────────────────── */
function Hero({ c }: { c: LandingCopy }) {
  return (
    <section className='relative px-6 pt-32 pb-24 md:pt-40 md:pb-28'>
      <div className='mx-auto flex max-w-3xl flex-col items-center text-center'>
        <div
          className={cn(
            'landing-animate-fade-up mb-7 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-[#0e9e66] shadow-sm',
            GLASS
          )}
          style={{ animationDelay: '0ms' }}
        >
          <span className='relative flex size-1.5'>
            <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0e9e66] opacity-75' />
            <span className='relative inline-flex size-1.5 rounded-full bg-[#0e9e66]' />
          </span>
          {c.hero.badge}
        </div>

        <h1
          className='landing-animate-fade-up text-[clamp(2.5rem,5.5vw,4rem)] leading-[1.1] font-bold tracking-tight'
          style={{
            animationDelay: '60ms',
            filter: 'drop-shadow(0 12px 40px rgba(14,158,102,0.18))',
          }}
        >
          {c.hero.titleLead}
          <br />
          <span className={GRADIENT}>{c.hero.titleGradient}</span>
        </h1>

        <p
          className='landing-animate-fade-up mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground/80 opacity-0 md:text-lg'
          style={{ animationDelay: '120ms' }}
        >
          {c.hero.subtitle}
        </p>

        <div
          className='landing-animate-fade-up mt-9 flex flex-wrap items-center justify-center gap-3 opacity-0'
          style={{ animationDelay: '180ms' }}
        >
          <Button
            className={cn('group h-12 rounded-xl px-6 text-sm font-semibold', PRIMARY)}
            render={<Link to='/playground' />}
          >
            {c.hero.primaryCta}
            <ArrowRight className='ml-1.5 size-4 transition-transform duration-200 group-hover:translate-x-0.5' />
          </Button>
          <Button
            variant='outline'
            className={cn(
              'h-12 rounded-xl px-6 text-sm font-semibold hover:bg-white/80',
              GLASS
            )}
            render={<Link to='/keys' />}
          >
            {c.hero.secondaryCta}
          </Button>
        </div>

        <p
          className='landing-animate-fade-up mt-9 text-xs font-medium tracking-wide text-muted-foreground/45 opacity-0'
          style={{ animationDelay: '240ms' }}
        >
          {c.hero.upstreams}
        </p>
      </div>

      {/* Floating glass API-call card — depth + dreamy glow */}
      <div
        className='landing-animate-fade-up relative mx-auto mt-16 max-w-2xl opacity-0'
        style={{ animationDelay: '320ms' }}
      >
        <div
          aria-hidden
          className='landing-aurora absolute -inset-8 -z-10 rounded-[2rem] opacity-70 blur-3xl'
          style={{
            background:
              'radial-gradient(60% 60% at 50% 40%, rgba(14,158,102,0.35), transparent 70%)',
          }}
        />
        <div className='landing-float'>
          <div
            className={cn(
              'overflow-hidden rounded-2xl shadow-[0_40px_90px_-30px_rgba(14,158,102,0.5)]',
              GLASS
            )}
          >
            <div className='flex items-center gap-2 border-b border-white/40 px-4 py-3 dark:border-white/10'>
              <span className='size-3 rounded-full bg-red-400/70' />
              <span className='size-3 rounded-full bg-amber-400/70' />
              <span className='size-3 rounded-full bg-green-400/70' />
              <span className='ml-2 font-mono text-xs text-muted-foreground/60'>
                api.anyrouters.com
              </span>
            </div>
            <div className='space-y-1.5 px-5 py-5 text-left font-mono text-[13px] leading-relaxed'>
              <p className='text-muted-foreground/60'>
                <span className='text-[#0e9e66]'>$</span> curl
                api.anyrouters.com/v1/chat/completions \
              </p>
              <p className='pl-4 text-muted-foreground/50'>
                -H <span className='text-foreground/70'>"Authorization: Bearer sk-any-•••"</span> \
              </p>
              <p className='pl-4 text-muted-foreground/50'>
                -d{' '}
                <span className='text-foreground/70'>
                  {'{"model":"claude-sonnet", ...}'}
                </span>
              </p>
              <p className='pt-2'>
                <span className='inline-flex items-center gap-1.5 rounded-md bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400'>
                  <span className='size-1.5 rounded-full bg-green-500' />
                  200 OK
                </span>
                <span className='ml-2 text-muted-foreground/45'>
                  → routed to Anthropic upstream
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* floating accent pill for extra depth */}
        <div
          className={cn(
            'landing-float-slow absolute -right-3 -bottom-5 hidden items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold shadow-[0_16px_40px_-12px_rgba(14,158,102,0.45)] sm:flex',
            GLASS
          )}
        >
          <span className='size-2 rounded-full bg-[#0e9e66]' />
          GPT · Claude · Gemini
        </div>
      </div>
    </section>
  )
}

/* ── Module 1 · Workbench ─────────────────────────────────────────────── */
function Workbench({ c }: { c: LandingCopy }) {
  return (
    <section className='relative px-6 py-24 md:py-32'>
      <div className='mx-auto max-w-5xl'>
        <div className='mx-auto max-w-2xl text-center'>
          <Eyebrow>{c.workbench.eyebrow}</Eyebrow>
          <h2 className='mt-3 text-3xl font-bold tracking-tight md:text-4xl'>
            {c.workbench.title}
          </h2>
          <p className='mt-4 text-base leading-relaxed text-muted-foreground/80'>
            {c.workbench.desc}
          </p>
        </div>

        <div className='relative mx-auto mt-14 max-w-3xl'>
          <div
            aria-hidden
            className='landing-aurora absolute -inset-10 -z-10 rounded-[2.5rem] opacity-60 blur-3xl'
            style={{
              background:
                'radial-gradient(55% 55% at 50% 50%, rgba(46,204,113,0.30), transparent 70%)',
            }}
          />
          <div
            className={cn(
              'overflow-hidden rounded-2xl shadow-[0_40px_90px_-30px_rgba(14,158,102,0.4)]',
              GLASS
            )}
          >
            <div className='flex items-center gap-2 border-b border-white/40 px-4 py-3 dark:border-white/10'>
              <span className='size-3 rounded-full bg-red-400/70' />
              <span className='size-3 rounded-full bg-amber-400/70' />
              <span className='size-3 rounded-full bg-green-400/70' />
              <span className='ml-3 inline-flex items-center rounded-md bg-[#0e9e66]/10 px-2.5 py-1 text-xs font-medium text-[#0e9e66]'>
                {c.workbench.mockModel}
              </span>
            </div>
            <div className='space-y-4 px-5 py-7'>
              <div className='flex justify-end'>
                <div className='max-w-[78%] rounded-2xl rounded-br-sm bg-[#0e9e66] px-4 py-2.5 text-sm text-white shadow-[0_8px_24px_-10px_rgba(14,158,102,0.6)]'>
                  {c.workbench.mockUser}
                </div>
              </div>
              <div className='flex justify-start'>
                <div className='max-w-[78%] rounded-2xl rounded-bl-sm border border-black/5 bg-white/80 px-4 py-2.5 text-sm text-foreground/90 dark:bg-white/5'>
                  {c.workbench.mockReply}
                </div>
              </div>
            </div>
            <div className='flex items-center gap-2 border-t border-white/40 px-4 py-3 dark:border-white/10'>
              <div className='flex-1 rounded-lg bg-black/5 px-3 py-2 text-sm text-muted-foreground/50 dark:bg-white/5'>
                {c.workbench.mockInput}
              </div>
              <span className='grid size-9 place-items-center rounded-lg bg-[#0e9e66] text-white shadow-[0_8px_20px_-8px_rgba(14,158,102,0.7)]'>
                <ArrowUp className='size-4' />
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ── Module 2 · Integrations ──────────────────────────────────────────── */
function Integrations({ c }: { c: LandingCopy }) {
  return (
    <section className='relative px-6 py-24 md:py-32'>
      <div className='mx-auto max-w-5xl'>
        <div className='mx-auto max-w-2xl text-center'>
          <Eyebrow>{c.integrations.eyebrow}</Eyebrow>
          <h2 className='mt-3 text-3xl font-bold tracking-tight md:text-4xl'>
            {c.integrations.title}
          </h2>
          <p className='mt-4 text-base leading-relaxed text-muted-foreground/80'>
            {c.integrations.desc}
          </p>
        </div>

        <div className='mt-14 grid grid-cols-2 gap-4 md:grid-cols-3'>
          {c.integrations.tools.map((tool, i) => (
            <div
              key={`${tool.name}-${i}`}
              className={cn(
                'group flex items-center gap-3.5 rounded-2xl p-4 transition-all duration-300',
                GLASS,
                tool.soon
                  ? 'opacity-60'
                  : 'hover:-translate-y-1 hover:shadow-[0_18px_44px_-18px_rgba(14,158,102,0.5)]'
              )}
            >
              <span
                className={cn(
                  'grid size-11 shrink-0 place-items-center rounded-xl text-base font-bold',
                  tool.soon
                    ? 'bg-black/5 text-muted-foreground/50 dark:bg-white/10'
                    : 'bg-gradient-to-br from-[#0e9e66] to-[#2ecc71] text-white shadow-[0_8px_20px_-8px_rgba(14,158,102,0.7)]'
                )}
              >
                {tool.soon ? '+' : tool.name.charAt(0)}
              </span>
              <div className='min-w-0'>
                <div className='truncate text-sm font-semibold'>{tool.name}</div>
                {tool.tag ? (
                  <div className='mt-0.5 text-xs text-muted-foreground/55'>
                    {tool.tag}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── Module 3 · Pay as you go ─────────────────────────────────────────── */
function PricingTeaser({ c }: { c: LandingCopy }) {
  return (
    <section className='px-6 py-24 md:py-32'>
      <div
        className='relative mx-auto max-w-3xl overflow-hidden rounded-[2rem] px-8 py-16 text-center text-white shadow-[0_40px_100px_-30px_rgba(14,158,102,0.7)] md:px-12'
        style={{
          background:
            'linear-gradient(135deg, #0e9e66 0%, #1bbd84 45%, #0b7d51 100%)',
        }}
      >
        <div
          aria-hidden
          className='landing-aurora pointer-events-none absolute -top-1/3 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full opacity-50 blur-3xl'
          style={{ background: 'radial-gradient(circle, #83e6b8, transparent 70%)' }}
        />
        <div className='relative'>
          <p className='text-[11px] font-bold tracking-[0.18em] text-white/70 uppercase'>
            {c.pricing.eyebrow}
          </p>
          <h2 className='mt-3 text-3xl font-bold tracking-tight md:text-4xl'>
            {c.pricing.title}
          </h2>
          <p className='mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/80'>
            {c.pricing.desc}
          </p>
          <Button
            className='mt-8 h-12 rounded-xl bg-white px-7 text-sm font-semibold text-[#0e9e66] shadow-[0_12px_34px_-10px_rgba(0,0,0,0.4)] hover:bg-white/90'
            render={<Link to='/console/topup' />}
          >
            {c.pricing.cta}
          </Button>
        </div>
      </div>
    </section>
  )
}

/* ── Module 4 · Closing ───────────────────────────────────────────────── */
function Closing({ c }: { c: LandingCopy }) {
  return (
    <section className='relative px-6 pt-10 pb-28 text-center md:pb-36'>
      <div
        aria-hidden
        className='landing-aurora pointer-events-none absolute top-1/2 left-1/2 -z-10 h-72 w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-50 blur-3xl'
        style={{
          background: 'radial-gradient(circle, rgba(14,158,102,0.30), transparent 70%)',
        }}
      />
      <div className='mx-auto max-w-2xl'>
        <h2
          className='text-3xl font-bold tracking-tight md:text-5xl'
          style={{ filter: 'drop-shadow(0 10px 30px rgba(14,158,102,0.2))' }}
        >
          <span className={GRADIENT}>{c.closing.title}</span>
        </h2>
        <p className='mt-5 text-base text-muted-foreground/80'>{c.closing.desc}</p>
        <Button
          className={cn('group mt-9 h-12 rounded-xl px-7 text-sm font-semibold', PRIMARY)}
          render={<Link to='/playground' />}
        >
          {c.closing.cta}
          <ArrowRight className='ml-1.5 size-4 transition-transform duration-200 group-hover:translate-x-0.5' />
        </Button>
      </div>
    </section>
  )
}

/* ── Footer ───────────────────────────────────────────────────────────── */
function LandingFooter({ c }: { c: LandingCopy }) {
  const year = new Date().getFullYear()
  return (
    <footer className='border-t border-black/5 px-6 py-12 dark:border-white/10'>
      <div className='mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-end md:justify-between'>
        <div className='flex flex-col gap-3'>
          <BrandLogo />
          <p className='max-w-xs text-sm text-muted-foreground/70'>{c.slogan}</p>
        </div>
        <div className='flex flex-col gap-1.5 text-xs text-muted-foreground/40 md:items-end'>
          <p>© {year} AnyRouters</p>
          {/* AGPL-3.0 §7: the New API link + attribution line below are legally
              required — keep them (kept minimal). See COMPLIANCE-AGPL.md */}
          <p className='text-[10px] text-muted-foreground/30'>
            Frontend design and development by{' '}
            <a
              href='https://github.com/QuantumNous/new-api'
              target='_blank'
              rel='noopener noreferrer'
              className='underline-offset-2 hover:text-muted-foreground/60 hover:underline'
            >
              New API
            </a>{' '}
            contributors.
          </p>
        </div>
      </div>
    </footer>
  )
}

export function Landing() {
  const c = useLandingCopy()
  return (
    <PublicLayout
      showMainContainer={false}
      logo={<BrandLogo />}
      siteName='AnyRouters'
      navLinks={[{ title: c.nav.console, href: '/playground' }]}
    >
      <PageAurora />
      <Hero c={c} />
      <Workbench c={c} />
      <Integrations c={c} />
      <PricingTeaser c={c} />
      <Closing c={c} />
      <LandingFooter c={c} />
    </PublicLayout>
  )
}
