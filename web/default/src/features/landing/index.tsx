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
import { ArrowRight, ArrowUp, KeyRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Button } from '@/components/ui/button'
import { BrandLogo } from './components/brand-logo'
import { type LandingCopy, landingContent } from './content'

// Ink-first palette (ref: anyrouters.com). Primary actions are near-black;
// the gradient is a restrained blue→periwinkle accent used only on the
// headline's second line and small flourishes. Status uses green.
const PRIMARY =
  'bg-[#262b36] text-white shadow-[0_10px_30px_-10px_rgba(20,25,40,0.5)] hover:bg-[#1b1f28]'
const GRADIENT =
  'bg-gradient-to-r from-[#3b82f6] via-[#22a8e6] to-[#0fc6bf] bg-clip-text text-transparent'
const GLASS = 'border border-black/[0.06] bg-white/80 backdrop-blur-xl'
const CARD =
  'rounded-2xl border border-black/[0.06] bg-white shadow-[0_24px_60px_-26px_rgba(30,30,60,0.25)]'
const ACCENT = '#2575e6'

function useLandingCopy(): LandingCopy {
  const { i18n } = useTranslation()
  const lang = i18n.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  return landingContent[lang]
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      className='text-[11px] font-bold tracking-[0.18em] uppercase'
      style={{ color: ACCENT }}
    >
      {children}
    </p>
  )
}

/* Soft pastel gradient mesh — the "dreamy" backdrop. Concentrated near the
   top (hero) and faded out below so lower sections stay clean. */
function PageAurora() {
  return (
    <div
      aria-hidden
      className='pointer-events-none absolute inset-x-0 top-0 -z-10 h-[120vh] overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]'
    >
      <div
        className='landing-aurora absolute inset-0'
        style={{
          background: [
            'radial-gradient(42% 50% at 6% 6%, rgba(190,214,255,0.62), transparent 60%)',
            'radial-gradient(40% 45% at 40% 0%, rgba(200,232,250,0.55), transparent 60%)',
            'radial-gradient(45% 55% at 100% 12%, rgba(180,225,255,0.62), transparent 62%)',
            'radial-gradient(46% 55% at 92% 86%, rgba(196,240,236,0.52), transparent 60%)',
            'radial-gradient(40% 50% at 8% 88%, rgba(255,224,210,0.32), transparent 60%)',
          ].join(','),
        }}
      />
      <div className='absolute inset-0 bg-[linear-gradient(to_right,rgba(40,40,80,0.5)_1px,transparent_1px),linear-gradient(to_bottom,rgba(40,40,80,0.5)_1px,transparent_1px)] bg-[size:3.5rem_3.5rem] opacity-[0.03] [mask-image:radial-gradient(ellipse_70%_50%_at_50%_0%,black,transparent_75%)]' />
    </div>
  )
}

/* ── Hero floating cards ──────────────────────────────────────────────── */
function CodeCard() {
  const k = 'text-[#2f6ae0]'
  const fn = 'text-[#1aa3bf]'
  const str = 'text-[#16a34a]'
  return (
    <div className={cn('overflow-hidden', CARD)}>
      <div className='flex items-center gap-1.5 border-b border-black/5 px-4 py-3'>
        <span className='size-2.5 rounded-full bg-black/15' />
        <span className='size-2.5 rounded-full bg-black/15' />
        <span className='size-2.5 rounded-full bg-black/15' />
        <span className='ml-2 font-mono text-xs text-muted-foreground/50'>
          request.py
        </span>
      </div>
      <div className='space-y-0.5 px-5 py-4 text-left font-mono text-[12.5px] leading-[1.65] text-foreground/80'>
        <div>
          <span className={k}>from</span> openai <span className={k}>import</span>{' '}
          OpenAI
        </div>
        <div className='h-2' />
        <div>
          client = <span className={fn}>OpenAI</span>(
        </div>
        <div className='pl-4'>
          <span className='text-foreground/50'>base_url</span>=
          <span className={str}>"https://api.anyrouters.com/v1"</span>,
        </div>
        <div className='pl-4'>
          <span className='text-foreground/50'>api_key</span>=
          <span className={str}>"sk-anyrouters-…"</span>,
        </div>
        <div>)</div>
        <div>
          client.chat.completions.<span className={fn}>create</span>(
        </div>
        <div className='pl-4'>
          model=<span className={str}>"claude-opus-4"</span>,
          <span className='text-muted-foreground/40'> # or gpt-5, gemini-2.5</span>
        </div>
        <div className='pl-4'>
          messages=<span className={str}>{'[{"role":"user", …}]'}</span>,
        </div>
        <div>)</div>
      </div>
    </div>
  )
}

function UpstreamsCard({ c }: { c: LandingCopy }) {
  const ups = ['OpenAI', 'Anthropic', 'Google Gemini', 'AWS Bedrock']
  return (
    <div className={cn('p-4', CARD)}>
      <p className='mb-3 text-[10px] font-bold tracking-[0.15em] text-muted-foreground/45 uppercase'>
        {c.hero.cardUpstreams}
      </p>
      <div className='space-y-2.5'>
        {ups.map((u) => (
          <div key={u} className='flex items-center justify-between text-[13px]'>
            <span className='text-foreground/80'>{u}</span>
            <span className='inline-flex items-center gap-1.5 text-xs text-[#16b07a]'>
              <span className='size-1.5 rounded-full bg-[#16b07a]' />
              {c.hero.cardOperational}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BalanceCard({ c }: { c: LandingCopy }) {
  return (
    <div className={cn('p-4', CARD)}>
      <p className='mb-2 text-[10px] font-bold tracking-[0.15em] text-muted-foreground/45 uppercase'>
        {c.hero.cardBalance}
      </p>
      <p className='text-[28px] leading-none font-extrabold tracking-tight'>
        <span className='align-top text-base text-muted-foreground/55'>$</span>
        48.20
      </p>
      <p className='mt-1.5 text-xs text-muted-foreground/50'>
        {c.hero.cardBalanceNote}
      </p>
      <div className='mt-3 h-1.5 w-full overflow-hidden rounded-full bg-black/5'>
        <div className='h-full w-[68%] rounded-full bg-gradient-to-r from-[#3b82f6] to-[#0fc6bf]' />
      </div>
    </div>
  )
}

/* ── Hero ─────────────────────────────────────────────────────────────── */
function Hero({ c }: { c: LandingCopy }) {
  return (
    <section className='relative px-6 pt-32 pb-20 md:pt-40'>
      <div className='mx-auto flex max-w-3xl flex-col items-center text-center'>
        <div
          className={cn(
            'landing-animate-fade-up mb-7 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold text-foreground/70 shadow-sm',
            GLASS
          )}
          style={{ animationDelay: '0ms' }}
        >
          <span className='size-1.5 rounded-full bg-[#16b07a]' />
          {c.hero.badge}
        </div>

        <h1
          className='landing-animate-fade-up text-[clamp(2.75rem,6vw,4.5rem)] leading-[1.05] font-extrabold tracking-[-0.02em]'
          style={{ animationDelay: '60ms' }}
        >
          {c.hero.titleLead}
          <br />
          <span className={GRADIENT}>{c.hero.titleGradient}</span>
        </h1>

        <p
          className='landing-animate-fade-up mt-6 max-w-xl text-base leading-relaxed text-muted-foreground/80 opacity-0 md:text-lg'
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
              'h-12 rounded-xl px-6 text-sm font-semibold hover:bg-white',
              GLASS
            )}
            render={<Link to='/keys' />}
          >
            <KeyRound className='mr-1.5 size-4 text-muted-foreground/70' />
            {c.hero.secondaryCta}
          </Button>
        </div>
      </div>

      {/* Floating real-UI cards: upstreams · code · balance. The wide container
          plus far-out side offsets keep the side cards peeking clearly past the
          centred code card instead of being buried under it. */}
      <div className='relative mx-auto mt-16 max-w-5xl'>
        <div
          className='landing-animate-fade-up relative z-20 mx-auto max-w-xl opacity-0'
          style={{ animationDelay: '300ms' }}
        >
          <div className='landing-float'>
            <CodeCard />
          </div>
        </div>
        <div className='landing-float-slow absolute -top-6 left-0 z-10 hidden w-56 lg:block'>
          <UpstreamsCard c={c} />
        </div>
        <div className='landing-float-slow absolute right-0 top-28 z-10 hidden w-52 lg:block'>
          <BalanceCard c={c} />
        </div>
      </div>
    </section>
  )
}

/* ── Module 1 · Workbench ─────────────────────────────────────────────── */
function Workbench({ c }: { c: LandingCopy }) {
  return (
    <section className='relative px-6 py-24 md:py-28'>
      <div className='mx-auto max-w-5xl'>
        <div className='mx-auto max-w-2xl text-center'>
          <Eyebrow>{c.workbench.eyebrow}</Eyebrow>
          <h2 className='mt-3 text-3xl font-extrabold tracking-tight md:text-4xl'>
            {c.workbench.title}
          </h2>
          <p className='mt-4 text-base leading-relaxed text-muted-foreground/80'>
            {c.workbench.desc}
          </p>
        </div>

        <div className={cn('mx-auto mt-12 max-w-2xl overflow-hidden', CARD)}>
          <div className='flex items-center gap-1.5 border-b border-black/5 px-4 py-3'>
            <span className='size-2.5 rounded-full bg-black/15' />
            <span className='size-2.5 rounded-full bg-black/15' />
            <span className='size-2.5 rounded-full bg-black/15' />
            <span className='ml-3 inline-flex items-center rounded-md bg-black/[0.04] px-2.5 py-1 text-xs font-medium text-foreground/70'>
              {c.workbench.mockModel}
            </span>
          </div>
          <div className='space-y-4 px-5 py-7'>
            <div className='flex justify-end'>
              <div className='max-w-[78%] rounded-2xl rounded-br-sm bg-[#2f7df0] px-4 py-2.5 text-sm text-white'>
                {c.workbench.mockUser}
              </div>
            </div>
            <div className='flex justify-start'>
              <div className='max-w-[78%] rounded-2xl rounded-bl-sm bg-black/[0.04] px-4 py-2.5 text-sm text-foreground/90'>
                {c.workbench.mockReply}
              </div>
            </div>
          </div>
          <div className='flex items-center gap-2 border-t border-black/5 px-4 py-3'>
            <div className='flex-1 rounded-lg bg-black/[0.04] px-3 py-2 text-sm text-muted-foreground/50'>
              {c.workbench.mockInput}
            </div>
            <span className='grid size-9 place-items-center rounded-lg bg-[#2f7df0] text-white'>
              <ArrowUp className='size-4' />
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ── Module 2 · Integrations ──────────────────────────────────────────── */
function Integrations({ c }: { c: LandingCopy }) {
  return (
    <section id='features' className='relative scroll-mt-24 px-6 py-24 md:py-28'>
      <div className='mx-auto max-w-5xl'>
        <div className='mx-auto max-w-2xl text-center'>
          <Eyebrow>{c.integrations.eyebrow}</Eyebrow>
          <h2 className='mt-3 text-3xl font-extrabold tracking-tight md:text-4xl'>
            {c.integrations.title}
          </h2>
          <p className='mt-4 text-base leading-relaxed text-muted-foreground/80'>
            {c.integrations.desc}
          </p>
        </div>

        <div className='mt-12 grid grid-cols-2 gap-4 md:grid-cols-3'>
          {c.integrations.tools.map((tool, i) => (
            <div
              key={`${tool.name}-${i}`}
              className={cn(
                'group flex items-center gap-3.5 rounded-2xl border border-black/[0.06] bg-white/70 p-4 backdrop-blur-xl transition-all duration-300',
                tool.soon
                  ? 'opacity-55'
                  : 'hover:-translate-y-1 hover:shadow-[0_18px_44px_-22px_rgba(30,30,60,0.4)]'
              )}
            >
              <span
                className={cn(
                  'grid size-11 shrink-0 place-items-center rounded-xl text-base font-bold',
                  tool.soon
                    ? 'bg-black/[0.04] text-muted-foreground/50'
                    : 'bg-[#262b36] text-white'
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
    <section className='px-6 py-24 md:py-28'>
      <div
        className='relative mx-auto max-w-3xl overflow-hidden rounded-[2rem] px-8 py-16 text-center text-white shadow-[0_40px_90px_-34px_rgba(20,20,30,0.6)] md:px-12'
        style={{ background: '#262b36' }}
      >
        <div
          aria-hidden
          className='pointer-events-none absolute -top-1/3 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full opacity-40 blur-3xl'
          style={{
            background:
              'radial-gradient(circle, rgba(47,130,240,0.85), transparent 70%)',
          }}
        />
        <div className='relative'>
          <p className='text-[11px] font-bold tracking-[0.18em] text-white/55 uppercase'>
            {c.pricing.eyebrow}
          </p>
          <h2 className='mt-3 text-3xl font-extrabold tracking-tight md:text-4xl'>
            {c.pricing.title}
          </h2>
          <p className='mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/70'>
            {c.pricing.desc}
          </p>
          <Button
            className='mt-8 h-12 rounded-xl bg-white px-7 text-sm font-semibold text-[#262b36] hover:bg-white/90'
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
    <section className='relative px-6 pt-8 pb-28 text-center md:pb-36'>
      <div className='mx-auto max-w-2xl'>
        <h2 className='text-3xl font-extrabold tracking-tight md:text-5xl'>
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

/* ── Header (custom, slim, glass) ─────────────────────────────────────── */
function LandingHeader({ c }: { c: LandingCopy }) {
  const { auth } = useAuthStore()
  const isAuthenticated = !!auth.user
  return (
    <header className='fixed inset-x-0 top-0 z-50 px-4 pt-3'>
      <nav
        className={cn(
          'mx-auto flex max-w-6xl items-center justify-between rounded-2xl py-2.5 pr-2.5 pl-4 shadow-[0_4px_30px_-12px_rgba(30,30,60,0.18)]',
          GLASS
        )}
      >
        <Link to='/' className='flex items-center transition-opacity hover:opacity-80'>
          <BrandLogo />
        </Link>
        <div className='flex items-center gap-1'>
          <a
            href='#features'
            className='hidden rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex'
          >
            {c.nav.features}
          </a>
          {/* The console CTA stays visible whether or not you're signed in;
              authenticated visitors additionally get the avatar menu. The
              language switcher sits to the right of the avatar. */}
          <Button
            size='sm'
            className={cn('h-9 rounded-lg px-4 text-xs font-semibold', PRIMARY)}
            render={<Link to='/playground' />}
          >
            {c.nav.console}
          </Button>
          {isAuthenticated && <ProfileDropdown />}
          <LanguageSwitcher />
        </div>
      </nav>
    </header>
  )
}

/* ── Footer ───────────────────────────────────────────────────────────── */
function LandingFooter({ c }: { c: LandingCopy }) {
  const year = new Date().getFullYear()
  return (
    <footer className='border-t border-black/5 px-6 py-12'>
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
    <div className='relative min-h-svh overflow-x-clip bg-[#fbfaff] text-foreground'>
      <PageAurora />
      <LandingHeader c={c} />
      <Hero c={c} />
      <Workbench c={c} />
      <Integrations c={c} />
      <PricingTeaser c={c} />
      <Closing c={c} />
      <LandingFooter c={c} />
    </div>
  )
}
