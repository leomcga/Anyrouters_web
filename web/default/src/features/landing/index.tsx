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
import { useEffect, useMemo, type ComponentType } from 'react'
import { Link } from '@tanstack/react-router'
import ClaudeIcon from '@lobehub/icons/es/Claude'
import ClaudeCodeIcon from '@lobehub/icons/es/ClaudeCode'
import CodexIcon from '@lobehub/icons/es/Codex'
import CursorIcon from '@lobehub/icons/es/Cursor'
import GeminiIcon from '@lobehub/icons/es/Gemini'
import LangChainIcon from '@lobehub/icons/es/LangChain'
import OpenAIIcon from '@lobehub/icons/es/OpenAI'
import VercelIcon from '@lobehub/icons/es/Vercel'
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  CircleHelp,
  Copy as CopyIcon,
  Database,
  Globe2,
  KeyRound,
  Layers3,
  Lock,
  MessageSquare,
  PanelLeftClose,
  ReceiptText,
  Route,
  Search,
  ServerCog,
  Settings,
  ShieldCheck,
  WalletCards,
  Zap,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import CardSwap, { Card } from '@/components/common/effects/CardSwap'
import Strands from '@/components/common/effects/Strands'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { BrandLogo } from './components/brand-logo'
import {
  type LandingCopy,
  type ProviderItem,
  type ToolItem,
  landingContent,
} from './content'

function useLandingCopy(): LandingCopy {
  const { i18n } = useTranslation()
  const lang = i18n.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  return landingContent[lang]
}

function resolveApiBaseURL(serverAddress?: string) {
  if (typeof window === 'undefined') return 'https://api.anyrouters.com'

  const hostname = window.location.hostname
  if (
    hostname === 'anyrouters.com' ||
    hostname === 'www.anyrouters.com' ||
    hostname === '127.0.0.1' ||
    hostname === 'localhost'
  ) {
    return 'https://api.anyrouters.com'
  }

  const fallback = window.location.origin.replace(/\/+$/, '')
  const raw = (serverAddress || fallback).replace(/\/+$/, '')

  try {
    const parsed = new URL(raw)
    if (
      parsed.hostname === 'anyrouters.com' ||
      parsed.hostname === 'www.anyrouters.com'
    ) {
      return 'https://api.anyrouters.com'
    }
  } catch {
    return raw
  }

  return raw
}

function isZh(c: LandingCopy) {
  return c.nav.login === '登录'
}

type LandingIcon = ComponentType<{ size?: number }> &
  Record<string, ComponentType<{ size?: number }>>

const LANDING_ICONS: Record<string, LandingIcon> = {
  Claude: ClaudeIcon as unknown as LandingIcon,
  ClaudeCode: ClaudeCodeIcon as unknown as LandingIcon,
  Codex: CodexIcon as unknown as LandingIcon,
  Cursor: CursorIcon as unknown as LandingIcon,
  Gemini: GeminiIcon as unknown as LandingIcon,
  LangChain: LangChainIcon as unknown as LandingIcon,
  OpenAI: OpenAIIcon as unknown as LandingIcon,
  Vercel: VercelIcon as unknown as LandingIcon,
}

function landingIcon(iconName: string, size: number) {
  const [baseName, variant] = iconName.split('.')
  const baseIcon = LANDING_ICONS[baseName]
  const Icon = (variant && baseIcon?.[variant]) || baseIcon
  if (Icon) return <Icon size={size} />

  return (
    <span
      className='bg-muted text-muted-foreground inline-flex items-center justify-center rounded-full text-xs font-medium'
      style={{ width: size, height: size }}
    >
      {iconName.charAt(0).toUpperCase() || '?'}
    </span>
  )
}

function providerIcon(provider: ProviderItem, size = 28) {
  return landingIcon(provider.icon, size)
}

function toolIcon(tool: ToolItem, size = 28) {
  return landingIcon(tool.icon, size)
}

function LandingHeader({ c }: { c: LandingCopy }) {
  const { auth } = useAuthStore()
  const isAuthenticated = !!auth.user

  return (
    <header className='fixed inset-x-0 top-0 z-50 px-4 pt-3'>
      <nav className='ar-landing-header'>
        <Link to='/' className='flex items-center hover:opacity-80'>
          <BrandLogo />
        </Link>

        <div className='ar-header-actions'>
          {isAuthenticated ? (
            <>
              <Link className='ar-header-primary' to='/dashboard'>
                {c.nav.console}
              </Link>
              <ProfileDropdown />
            </>
          ) : (
            <>
              <Link className='ar-header-link' to='/sign-in'>
                {c.nav.login}
              </Link>
              <Link className='ar-header-primary' to='/sign-up'>
                {c.nav.register}
              </Link>
            </>
          )}
          <LanguageSwitcher />
        </div>
      </nav>
    </header>
  )
}

function HeroEffectLayer() {
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (prefersReducedMotion) {
    return (
      <div
        className='allrouters-hero-effect-layer allrouters-hero-effect-strands allrouters-hero-effect-static'
        aria-hidden='true'
      />
    )
  }

  return (
    <div
      className='allrouters-hero-effect-layer allrouters-hero-effect-strands allrouters-strands-layer'
      aria-hidden='true'
    >
      <Strands
        colors={['#5F8CFF', '#8EA6FF', '#D7E2FF']}
        count={3}
        speed={0.075}
        amplitude={0.72}
        waviness={0.82}
        thickness={0.42}
        glow={1.98}
        taper={1.65}
        spread={1.15}
        intensity={0.42}
        saturation={1}
        opacity={0.52}
        scale={4.15}
      />
    </div>
  )
}

function HeroProofRow({ c }: { c: LandingCopy }) {
  const capabilities = isZh(c)
    ? ['统一 API 入口', '用户自选模型', '用量计量', '钱包账单']
    : [
        'Unified API entry',
        'User-selected models',
        'Usage metering',
        'Wallet ledger',
      ]

  return (
    <div className='allrouters-trust-summary allrouters-reveal allrouters-delay-5'>
      <div className='allrouters-trust-summary-providers'>
        <span>{c.providers.label}</span>
        <div aria-label={c.providers.label}>
          {c.providers.items.map((provider) => (
            <div className='allrouters-trust-logo' key={provider.name}>
              {providerIcon(provider)}
              <strong>{provider.name}</strong>
            </div>
          ))}
        </div>
      </div>
      <i className='allrouters-trust-summary-divider' aria-hidden='true' />
      <div className='allrouters-trust-summary-capabilities'>
        {capabilities.map((item) => (
          <span key={item}>
            <CheckCircle2 size={15} />
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

function GatewayConsole({
  c,
  openAIBaseURL,
}: {
  c: LandingCopy
  openAIBaseURL: string
}) {
  const zh = isZh(c)
  const preview = zh
    ? {
        production: '产品预览',
        sidebarGroups: [
          {
            label: '常用',
            items: [
              ['wallet', '钱包充值'],
              ['dashboard', '数据看板'],
              ['settings', '设置'],
              ['support', '工单/客服'],
            ],
          },
          { label: '工作区', items: [['chat', '聊天']] },
          {
            label: 'API 配置',
            items: [
              ['models', '模型广场'],
              ['key', '创建 API Keys'],
              ['usage', '用量明细'],
              ['docs', '教程文档'],
            ],
          },
        ],
        collapseLabel: '收起侧栏',
        showcasePill: '网关概览',
        title: '产品展示口',
        liveStatus: '网关概览',
        statusPill: '统一 API 入口',
        panelTitle: '模型接入控制台',
        panelDesc: '统一管理模型调用、API Key、用量与账单',
        badges: ['统一 API 入口', '模型广场', '用量计量'],
        channelTitle: '模型通道状态',
        running: '运行中',
        routeTitle: 'API 调用示例',
        requestLabel: '请求 AnyRouters API',
        routerLabel: 'AnyRouters API',
        routerDesc: '鉴权 · 额度 · 计量',
        bestModelLabel: 'model 参数由用户指定',
        modelListLabel: '可调用模型',
        codeTabs: ['cURL', 'Python', 'JavaScript'],
        codeLines: [
          ['keyword', 'curl'],
          ['plain', ` ${openAIBaseURL}/chat/completions \\\n`],
          ['plain', '  -H '],
          ['string', '"Authorization: Bearer sk-..."'],
          ['plain', ' \\\n  -H '],
          ['string', '"Content-Type: application/json"'],
          ['plain', ' \\\n  -d '],
          ['string', '\'{"model":'],
          ['string', '"claude"'],
          ['string', ',"messages":[...]}\''],
        ],
        balanceLabel: '账户余额',
        balance: '$48.20',
        usage: '本月 · 1.2M tokens',
        progress: '60%',
        balanceStats: [
          ['成功率', '99.98%'],
          ['请求次数', '2.46M'],
        ],
        ledgerLink: '查看用量明细',
        recentTitle: '最近请求',
        recentHeaders: ['时间', '模型', '状态', '延迟', 'Tokens'],
        recentRows: [
          ['14:23:56', 'OpenAI', '成功', '812ms', '1.2K'],
          ['14:23:41', 'Claude', '成功', '1.03s', '2.1K'],
          ['14:23:29', 'Gemini', '成功', '742ms', '1.7K'],
        ],
        recentLink: '查看全部请求',
        strategyTitle: '接入设置',
        strategies: [
          ['模型选择', '由用户在模型广场或请求参数中选择', '可配置'],
          ['稳定转发', '统一 Base URL 承接调用请求', '已启用'],
          ['用量计量', '记录 token、费用与请求日志', '已启用'],
        ],
        strategyLink: '查看接入设置',
      }
    : {
        production: 'product preview',
        sidebarGroups: [
          {
            label: 'Common',
            items: [
              ['wallet', 'Top up'],
              ['dashboard', 'Dashboard'],
              ['settings', 'Settings'],
              ['support', 'Support'],
            ],
          },
          { label: 'Workspace', items: [['chat', 'Chat']] },
          {
            label: 'API config',
            items: [
              ['models', 'Model catalog'],
              ['key', 'Create API Keys'],
              ['usage', 'Usage details'],
              ['docs', 'Docs'],
            ],
          },
        ],
        collapseLabel: 'Collapse',
        showcasePill: 'Gateway overview',
        title: 'Product showcase',
        liveStatus: 'Gateway overview',
        statusPill: 'Unified API entry',
        panelTitle: 'Model access console',
        panelDesc:
          'Manage model calls, API keys, usage and billing in one place',
        badges: ['Unified API entry', 'Model catalog', 'Usage metering'],
        channelTitle: 'Model channel status',
        running: 'Running',
        routeTitle: 'API request example',
        requestLabel: 'Call AnyRouters API',
        routerLabel: 'AnyRouters API',
        routerDesc: 'auth · quota · metering',
        bestModelLabel: 'model set by user',
        modelListLabel: 'Available models',
        codeTabs: ['cURL', 'Python', 'JavaScript'],
        codeLines: [
          ['keyword', 'curl'],
          ['plain', ` ${openAIBaseURL}/chat/completions \\\n`],
          ['plain', '  -H '],
          ['string', '"Authorization: Bearer sk-..."'],
          ['plain', ' \\\n  -H '],
          ['string', '"Content-Type: application/json"'],
          ['plain', ' \\\n  -d '],
          ['string', '\'{"model":'],
          ['string', '"claude"'],
          ['string', ',"messages":[...]}\''],
        ],
        balanceLabel: 'Account balance',
        balance: '$48.20',
        usage: 'This month · 1.2M tokens',
        progress: '60%',
        balanceStats: [
          ['Success rate', '99.98%'],
          ['Requests', '2.46M'],
        ],
        ledgerLink: 'View usage details',
        recentTitle: 'Recent requests',
        recentHeaders: ['Time', 'Model', 'Status', 'Latency', 'Tokens'],
        recentRows: [
          ['14:23:56', 'OpenAI', 'success', '812ms', '1.2K'],
          ['14:23:41', 'Claude', 'success', '1.03s', '2.1K'],
          ['14:23:29', 'Gemini', 'success', '742ms', '1.7K'],
        ],
        recentLink: 'View all requests',
        strategyTitle: 'Access settings',
        strategies: [
          [
            'Model selection',
            'Chosen in the catalog or request parameter',
            'Configurable',
          ],
          ['Stable relay', 'One Base URL receives model calls', 'Enabled'],
          [
            'Usage metering',
            'Tokens, cost and request logs are recorded',
            'Enabled',
          ],
        ],
        strategyLink: 'View access settings',
      }
  const sidebarIconMap = {
    wallet: WalletCards,
    dashboard: BarChart3,
    settings: Settings,
    support: CircleHelp,
    chat: MessageSquare,
    models: Layers3,
    key: KeyRound,
    usage: ReceiptText,
    docs: BookOpen,
  }

  return (
    <div className='allrouters-gateway-console allrouters-reveal allrouters-delay-3'>
      <div className='allrouters-console-framebar' aria-hidden='true'>
        <div className='allrouters-console-window-dots'>
          <span />
          <span />
          <span />
        </div>
        <div className='allrouters-console-address'>console.anyrouters.com</div>
        <div className='allrouters-console-chip'>{preview.production}</div>
      </div>

      <div className='allrouters-console-shell'>
        <aside className='allrouters-console-sidebar' aria-hidden='true'>
          <div className='allrouters-console-brand'>
            <span>
              <img
                className='allrouters-brand-mark-image'
                src='/anyrouters-mark-transparent.png'
                alt=''
              />
            </span>
            <strong>AnyRouters</strong>
          </div>
          <div className='allrouters-console-showcase-pill'>
            <Route size={13} />
            <span>{preview.showcasePill}</span>
          </div>
          <div className='allrouters-console-nav'>
            {preview.sidebarGroups.map((group) => (
              <div className='allrouters-console-nav-group' key={group.label}>
                <b>{group.label}</b>
                {group.items.map(([iconName, item]) => {
                  const Icon =
                    sidebarIconMap[iconName as keyof typeof sidebarIconMap] ||
                    Layers3
                  return (
                    <span key={item}>
                      <Icon size={13} />
                      <em>{item}</em>
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
          <div className='allrouters-console-keycard'>
            <PanelLeftClose size={14} />
            <span>{preview.collapseLabel}</span>
          </div>
        </aside>

        <div className='allrouters-console-main'>
          <div className='allrouters-console-topbar'>
            <div>
              <span>{preview.title}</span>
              <strong>{preview.liveStatus}</strong>
            </div>
            <div className='allrouters-console-status'>
              <span className='allrouters-live-dot' />
              {preview.statusPill}
            </div>
          </div>

          <div
            className='allrouters-preview-showcase'
            aria-label={preview.production}
          >
            <div className='allrouters-preview-header'>
              <div>
                <strong>{preview.panelTitle}</strong>
                <span>{preview.panelDesc}</span>
              </div>
              <div>
                {preview.badges.map((badge) => (
                  <b key={badge}>
                    <CheckCircle2 size={12} />
                    {badge}
                  </b>
                ))}
              </div>
            </div>

            <div className='allrouters-preview-card allrouters-preview-upstreams'>
              <span className='allrouters-preview-label'>
                {preview.channelTitle}
              </span>
              <div>
                {c.providers.items.map((provider) => (
                  <div
                    className='allrouters-preview-provider'
                    key={provider.name}
                  >
                    <span>
                      {providerIcon(provider)}
                      {provider.name}
                    </span>
                    <b>
                      <i />
                      {preview.running}
                    </b>
                  </div>
                ))}
              </div>
              <a>{preview.recentLink}</a>
            </div>

            <div className='allrouters-preview-card allrouters-preview-route-card'>
              <div className='allrouters-preview-label-row'>
                <span className='allrouters-preview-label'>
                  {preview.routeTitle}
                </span>
                <b>{preview.bestModelLabel}</b>
              </div>
              <div className='allrouters-api-flow'>
                <div className='allrouters-api-flow-node allrouters-api-flow-request'>
                  <span>{preview.requestLabel}</span>
                  <i aria-hidden='true'>
                    <b>POST</b>
                  </i>
                  <small>/v1/chat/completions</small>
                </div>
                <ArrowRight className='allrouters-api-flow-arrow' size={16} />
                <div className='allrouters-api-flow-node allrouters-api-flow-gateway'>
                  <span>{preview.routerLabel}</span>
                  <i>
                    <img
                      className='allrouters-brand-mark-image'
                      src='/anyrouters-mark-transparent.png'
                      alt=''
                    />
                  </i>
                  <small>{preview.routerDesc}</small>
                </div>
                <svg
                  aria-hidden='true'
                  className='allrouters-api-flow-lines'
                  preserveAspectRatio='none'
                  viewBox='0 0 128 84'
                >
                  <path d='M4 42 C 32 42, 40 16, 76 16 L124 16' />
                  <path d='M4 42 C 38 42, 66 42, 124 42' />
                  <path d='M4 42 C 32 42, 40 68, 76 68 L124 68' />
                </svg>
                <div className='allrouters-api-flow-models'>
                  <span>{preview.modelListLabel}</span>
                  {c.providers.items.map((provider) => (
                    <b
                      className={
                        provider.name === 'Claude'
                          ? 'allrouters-api-flow-model-active'
                          : ''
                      }
                      key={provider.name}
                    >
                      <i aria-hidden='true'>{providerIcon(provider, 15)}</i>
                      <span>{provider.name}</span>
                    </b>
                  ))}
                </div>
              </div>
              <div className='allrouters-preview-code-card'>
                <div className='allrouters-preview-code-tabs'>
                  {preview.codeTabs.map((tab, index) => (
                    <span
                      className={
                        index === 0 ? 'allrouters-code-tab-active' : ''
                      }
                      key={tab}
                    >
                      {tab}
                    </span>
                  ))}
                  <CopyIcon size={12} />
                </div>
                <pre>
                  <code>
                    {preview.codeLines.map(([tone, value], index) => (
                      <span
                        className={`allrouters-code-token-${tone}`}
                        key={index}
                      >
                        {value}
                      </span>
                    ))}
                  </code>
                </pre>
              </div>
            </div>

            <div className='allrouters-preview-card allrouters-preview-balance'>
              <span className='allrouters-preview-label'>
                {preview.balanceLabel}
              </span>
              <strong>{preview.balance}</strong>
              <small>{preview.usage}</small>
              <i aria-hidden='true'>
                <b />
              </i>
              <div className='allrouters-preview-progress-meta'>
                <span>{preview.progress}</span>
              </div>
              <div className='allrouters-preview-balance-stats'>
                {preview.balanceStats.map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <a>{preview.ledgerLink}</a>
            </div>

            <div className='allrouters-preview-card allrouters-preview-recent'>
              <span className='allrouters-preview-label'>
                {preview.recentTitle}
              </span>
              <div className='allrouters-preview-request-list'>
                <div className='allrouters-preview-request-head'>
                  {preview.recentHeaders.map((header) => (
                    <span key={header}>{header}</span>
                  ))}
                </div>
                {preview.recentRows.map(
                  ([time, model, state, latency, tokens]) => (
                    <div
                      className='allrouters-preview-request-item'
                      key={`${time}-${model}`}
                    >
                      <span>{time}</span>
                      <strong>{model}</strong>
                      <b>{state}</b>
                      <em>{latency}</em>
                      <small>{tokens}</small>
                    </div>
                  )
                )}
              </div>
              <a>{preview.recentLink}</a>
            </div>

            <div className='allrouters-preview-card allrouters-preview-policy'>
              <span className='allrouters-preview-label'>
                {preview.strategyTitle}
              </span>
              <div className='allrouters-preview-policy-grid'>
                {preview.strategies.map(([title, desc, state]) => (
                  <div key={title}>
                    <strong>{title}</strong>
                    <span>{desc}</span>
                    <b>{state}</b>
                  </div>
                ))}
              </div>
              <a>{preview.strategyLink}</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CapabilityList({ c }: { c: LandingCopy }) {
  const icons = [
    Route,
    KeyRound,
    WalletCards,
    BarChart3,
    ServerCog,
    ShieldCheck,
  ]
  const architectureNodes = isZh(c)
    ? [
        ['调用方应用', '请求 AnyRouters API'],
        ['AnyRouters API', '鉴权 · 模型调用 · 计量'],
        ['聚合模型', 'OpenAI · Claude · Gemini'],
      ]
    : [
        ['Client app', 'Calls AnyRouters API'],
        ['AnyRouters API', 'auth · model call · meter'],
        ['Aggregated models', 'OpenAI · Claude · Gemini'],
      ]

  return (
    <section
      id='features'
      className='allrouters-section allrouters-shell allrouters-capability-section'
    >
      <div className='allrouters-capability-layout'>
        <div className='allrouters-sticky-copy'>
          <p className='allrouters-section-label'>{c.features.label}</p>
          <h2 className='allrouters-section-title mt-4'>{c.features.title}</h2>
          <p className='allrouters-section-copy mt-5'>{c.features.desc}</p>
        </div>
        <div className='allrouters-architecture-panel'>
          <div className='allrouters-architecture-flow' aria-hidden='true'>
            {architectureNodes.map(([label, value], index) => (
              <div className='allrouters-architecture-node' key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                {index < architectureNodes.length - 1 ? (
                  <i className='allrouters-architecture-connector' />
                ) : null}
              </div>
            ))}
          </div>

          <div className='allrouters-capability-rows'>
            {c.features.items.map((item, index) => {
              const Icon = icons[index] ?? CheckCircle2
              return (
                <article className='allrouters-capability-row' key={item.title}>
                  <div className='allrouters-feature-icon'>
                    <Icon size={20} />
                  </div>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function QuickIntegration({ c }: { c: LandingCopy }) {
  const zh = isZh(c)
  const tabs = zh ? ['对话', '生图', '生视频'] : ['Chat', 'Images', 'Video']
  const pickerRows = zh
    ? [
        ['Anthropic', 'Claude', '当前选择'],
        ['Google', 'Gemini', '快速'],
        ['OpenAI', 'OpenAI', '通用'],
      ]
    : [
        ['Anthropic', 'Claude', 'Selected'],
        ['Google', 'Gemini', 'Fast'],
        ['OpenAI', 'OpenAI', 'General'],
      ]
  const pickerPlaceholder = zh ? '搜索模型...' : 'Search models...'
  const pickerIcons = new Map(
    c.providers.items.map((provider) => [provider.name, provider])
  )

  return (
    <section
      id='online'
      className='allrouters-section allrouters-shell allrouters-quick-section'
    >
      <div className='allrouters-quick-heading'>
        <p className='allrouters-section-label'>{c.quick.label}</p>
        <h2 className='allrouters-section-title'>{c.quick.title}</h2>
        <p className='allrouters-section-copy'>{c.quick.desc}</p>
      </div>

      <div className='allrouters-quick-showcase'>
        <div className='allrouters-chat-window'>
          <div className='allrouters-chat-titlebar'>
            <div className='allrouters-console-window-dots'>
              <span />
              <span />
              <span />
            </div>
            <div className='allrouters-chat-tabs'>
              {tabs.map((tab, index) => (
                <span
                  className={index === 0 ? 'allrouters-chat-tab-active' : ''}
                  key={tab}
                >
                  {tab}
                </span>
              ))}
            </div>
          </div>
          <div className='allrouters-chat-body'>
            <div className='allrouters-chat-bubble allrouters-chat-bubble-user'>
              {c.quick.prompt}
            </div>
            <div className='allrouters-chat-bubble allrouters-chat-bubble-ai'>
              {c.quick.reply}
            </div>
          </div>
          <div className='allrouters-chat-input'>
            <span>{zh ? '进入聊天工作台' : 'Open chat workspace'}</span>
            <Link
              to='/dashboard'
              aria-label={zh ? '进入聊天工作台' : 'Open chat workspace'}
            >
              <ArrowRight size={18} />
            </Link>
          </div>
          <div className='allrouters-chat-model-picker' aria-hidden='true'>
            <div className='allrouters-chat-model-search'>
              <Search size={13} />
              <span>{pickerPlaceholder}</span>
            </div>
            <div className='allrouters-chat-model-list'>
              {pickerRows.map(([group, model, tag]) => {
                const provider = pickerIcons.get(model)
                return (
                  <div
                    className='allrouters-chat-model-row'
                    key={`${group}-${model}`}
                  >
                    <small>{group}</small>
                    <span>
                      {provider ? providerIcon(provider, 16) : null}
                      <strong>{model}</strong>
                      <b>{tag}</b>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className='allrouters-quick-steps'>
          {c.quick.steps.map((step, index) => (
            <article className='allrouters-quick-step' key={step.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{step.title}</strong>
              <p>{step.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function ToolchainSection({ c }: { c: LandingCopy }) {
  return (
    <section
      id='tools'
      className='allrouters-section allrouters-shell allrouters-tools-section'
    >
      <div className='allrouters-tools-layout'>
        <div className='allrouters-tools-copy'>
          <p className='allrouters-section-label'>{c.tools.label}</p>
          <h2 className='allrouters-section-title mt-4'>{c.tools.title}</h2>
          <p className='allrouters-section-copy mt-4'>{c.tools.desc}</p>
          <div className='allrouters-tool-logo-row' aria-label={c.tools.label}>
            {c.tools.items.map((tool) => (
              <span key={tool.name} title={tool.name}>
                {toolIcon(tool, 18)}
                <b>{tool.name}</b>
              </span>
            ))}
          </div>
        </div>
        <div className='allrouters-tool-swap-stage'>
          <CardSwap
            width={390}
            height={230}
            cardDistance={28}
            verticalDistance={24}
            delay={3600}
            skewAmount={1.3}
          >
            {c.tools.items.map((tool) => (
              <Card className='allrouters-tool-swap-card' key={tool.name}>
                <div className='allrouters-tool-swap-head'>
                  <span
                    className='allrouters-tool-swap-mark'
                    aria-hidden='true'
                  >
                    {toolIcon(tool)}
                  </span>
                  <div>
                    <strong>{tool.name}</strong>
                    <p>{tool.desc}</p>
                  </div>
                </div>
                <div className='allrouters-tool-swap-tags'>
                  {tool.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </Card>
            ))}
          </CardSwap>
        </div>
      </div>
    </section>
  )
}

function ControlPlane({ c }: { c: LandingCopy }) {
  const signalIcons = [Globe2, ReceiptText, Activity, Lock]

  return (
    <section
      id='about'
      className='allrouters-section allrouters-shell allrouters-control-section'
    >
      <div className='allrouters-control-panel allrouters-settlement-panel'>
        <div>
          <p className='allrouters-section-label'>{c.control.label}</p>
          <h2 className='allrouters-section-title mt-4'>{c.control.title}</h2>
          <p className='allrouters-section-copy mt-5 max-w-2xl'>
            {c.control.desc}
          </p>
          <div className='allrouters-settlement-signals'>
            {c.control.signals.map((label, index) => {
              const Icon = signalIcons[index] ?? CheckCircle2
              return (
                <div className='allrouters-signal-chip' key={label}>
                  <Icon size={18} />
                  <span>{label}</span>
                </div>
              )
            })}
          </div>
        </div>
        <div className='allrouters-ledger'>
          {c.control.items.map((item) => (
            <div className='allrouters-ledger-row' key={item.title}>
              <span>{item.title}</span>
              <strong>{item.desc}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FlowSection({ c }: { c: LandingCopy }) {
  return (
    <section className='allrouters-section allrouters-shell allrouters-flow-section'>
      <div className='flex flex-col gap-8'>
        <div className='max-w-3xl'>
          <p className='allrouters-section-label'>{c.flow.label}</p>
          <h2 className='allrouters-section-title mt-4'>{c.flow.title}</h2>
          <p className='allrouters-section-copy allrouters-flow-desc mt-4'>
            {c.flow.desc}
          </p>
        </div>
        <div className='allrouters-flow-track'>
          {c.flow.items.map((item, index) => (
            <article className='allrouters-flow-step' key={item.title}>
              <div className='allrouters-flow-index'>
                {String(index + 1).padStart(2, '0')}
              </div>
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function BillingBanner({ c }: { c: LandingCopy }) {
  return (
    <section className='allrouters-section allrouters-billing-section'>
      <div className='allrouters-shell'>
        <div className='allrouters-billing-panel'>
          <p>{c.billing.label}</p>
          <h2>{c.billing.title}</h2>
          <span>{c.billing.desc}</span>
          <Link className='allrouters-billing-cta' to='/wallet'>
            {c.billing.cta}
          </Link>
        </div>
      </div>
    </section>
  )
}

function ClosingSection({ c }: { c: LandingCopy }) {
  const zh = isZh(c)

  return (
    <section className='allrouters-section allrouters-shell allrouters-closing-section pb-20'>
      <div className='allrouters-closing'>
        <div>
          <p className='allrouters-section-label'>AnyRouters</p>
          <h2 className='allrouters-section-title mt-4'>{c.closing.title}</h2>
          <p className='allrouters-section-copy mt-5 max-w-3xl'>
            {c.closing.desc}
          </p>
        </div>
        <div className='flex flex-wrap gap-3'>
          <Link
            className='allrouters-cta allrouters-cta-primary'
            to='/dashboard'
          >
            <Zap size={18} />
            <span>{c.closing.cta}</span>
          </Link>
          <Link
            className='allrouters-cta allrouters-cta-secondary'
            to='/wallet'
          >
            <Database size={18} />
            <span>{zh ? '查看充值与账单' : 'Top up & billing'}</span>
          </Link>
        </div>
      </div>
    </section>
  )
}

function Hero({ c, openAIBaseURL }: { c: LandingCopy; openAIBaseURL: string }) {
  const handleCopyBaseURL = async () => {
    const ok = await copyToClipboard(openAIBaseURL)
    if (ok) toast.success(c.hero.copyBase)
  }

  return (
    <>
      <section className='allrouters-hero'>
        <div className='allrouters-hero-wordmark' aria-hidden='true'>
          AnyRouters
        </div>
        <HeroEffectLayer />
        <div className='allrouters-hero-inner allrouters-shell'>
          <div className='allrouters-hero-topline allrouters-reveal'>
            <div className='allrouters-hero-badge'>
              <span className='allrouters-live-dot' />
              {c.hero.label}
            </div>
            <div className='allrouters-hero-spec'>
              <span>{c.hero.baseLabel}</span>
              <span>AnyRouters</span>
              <span>{c.hero.walletPanelTitle}</span>
            </div>
          </div>

          <div className='allrouters-hero-layout'>
            <div className='allrouters-hero-copy'>
              <h1 className='allrouters-hero-title'>
                {c.hero.titleLines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </h1>
              <p className='allrouters-hero-lead allrouters-reveal allrouters-delay-2'>
                {c.hero.subtitle}
              </p>

              <div className='allrouters-base-card allrouters-reveal allrouters-delay-3'>
                <div>
                  <span>{c.hero.baseLabel}</span>
                  <code>{openAIBaseURL}</code>
                </div>
                <button
                  type='button'
                  className='allrouters-copy-button'
                  onClick={handleCopyBaseURL}
                  aria-label={c.hero.copyBase}
                  title={c.hero.copyBase}
                >
                  <CopyIcon size={17} />
                </button>
              </div>

              <div className='allrouters-cta-row allrouters-reveal allrouters-delay-4'>
                <Link
                  className='allrouters-cta allrouters-cta-primary'
                  to='/dashboard'
                >
                  <span>{c.hero.primaryCta}</span>
                  <ArrowRight size={18} />
                </Link>
                <Link
                  className='allrouters-cta allrouters-cta-ghost'
                  to='/pricing'
                >
                  <Layers3 size={18} />
                  <span>{isZh(c) ? '查看模型广场' : 'Model Catalog'}</span>
                </Link>
              </div>
            </div>

            <div className='allrouters-hero-visual'>
              <GatewayConsole c={c} openAIBaseURL={openAIBaseURL} />
            </div>
          </div>
        </div>
      </section>

      <section className='allrouters-hero-trust-band allrouters-shell'>
        <HeroProofRow c={c} />
      </section>
    </>
  )
}

function LandingFooter({ c }: { c: LandingCopy }) {
  const year = new Date().getFullYear()

  return (
    <footer className='border-t border-black/5 px-6 py-12'>
      <div className='mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-end md:justify-between'>
        <div className='flex flex-col gap-3'>
          <BrandLogo />
          <p className='text-muted-foreground/70 max-w-xs text-sm'>
            {c.slogan}
          </p>
        </div>
        <div className='text-muted-foreground/40 flex flex-col gap-1.5 text-xs md:items-end'>
          <p>© {year} AnyRouters</p>
          <p className='text-muted-foreground/30 text-[10px]'>
            Frontend design and development by{' '}
            <a
              href='https://github.com/QuantumNous/new-api'
              target='_blank'
              rel='noopener noreferrer'
              className='hover:text-muted-foreground/60 underline-offset-2 hover:underline'
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
  const apiBaseURL = useMemo(() => resolveApiBaseURL(), [])
  const openAIBaseURL = `${apiBaseURL}/v1`

  useEffect(() => {
    document.title = 'AnyRouters'
  }, [])

  return (
    <div className='classic-page-fill classic-home-page w-full overflow-x-hidden'>
      <LandingHeader c={c} />
      <main className='allrouters-home-surface classic-home-default allrouters-home-reference allrouters-home-reference-4 allrouters-home-effect-strands w-full overflow-x-hidden'>
        <Hero c={c} openAIBaseURL={openAIBaseURL} />
        <CapabilityList c={c} />
        <QuickIntegration c={c} />
        <ToolchainSection c={c} />
        <ControlPlane c={c} />
        <FlowSection c={c} />
        <BillingBanner c={c} />
        <ClosingSection c={c} />
      </main>
      <LandingFooter c={c} />
    </div>
  )
}
