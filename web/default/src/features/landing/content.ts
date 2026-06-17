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

/**
 * AnyRouters landing page copy.
 *
 * Kept self-contained (not in the global i18n locale files) while the design
 * is still iterating — language is picked from `i18n.language` at render time
 * so the top-bar language switcher still works. Once the copy stabilises it
 * can migrate into `src/i18n/locales/*`.
 */

export interface ToolItem {
  name: string
  tag: string
  /** Renders muted / dashed — not yet available */
  soon?: boolean
}

export interface LandingCopy {
  nav: { models: string; features: string; console: string }
  hero: {
    badge: string
    titleLead: string
    titleGradient: string
    subtitle: string
    primaryCta: string
    secondaryCta: string
    cardUpstreams: string
    cardOperational: string
    cardBalance: string
    cardBalanceNote: string
  }
  workbench: {
    eyebrow: string
    title: string
    desc: string
    mockModel: string
    mockUser: string
    mockReply: string
    mockInput: string
  }
  integrations: {
    eyebrow: string
    title: string
    desc: string
    tools: ToolItem[]
  }
  pricing: { eyebrow: string; title: string; desc: string; cta: string }
  closing: { title: string; desc: string; cta: string }
  slogan: string
}

export const landingContent: Record<'zh' | 'en', LandingCopy> = {
  zh: {
    nav: { models: '模型', features: '功能', console: '控制台' },
    hero: {
      badge: 'AnyRouters · 一个网关，调用所有模型',
      titleLead: '一个 API，',
      titleGradient: '调用所有前沿大模型',
      subtitle:
        'AnyRouters 把 OpenAI、Anthropic Claude、Google Gemini 与 AWS Bedrock 汇聚到单一 OpenAI 兼容端点 —— 一把密钥、一份账单、自动故障转移。',
      primaryCta: '立即使用',
      secondaryCta: '获取 API Key',
      cardUpstreams: '上游通道',
      cardOperational: '运行中',
      cardBalance: '账户余额',
      cardBalanceNote: '本月 · 1.2M tokens',
    },
    workbench: {
      eyebrow: '全能工作台',
      title: '免去配置，登录即用',
      desc: '一个干净的对话界面，自由切换 GPT、Claude、Gemini。智能路由在后台默默工作，你只管开始。',
      mockModel: 'Claude · Sonnet',
      mockUser: '帮我把这段会议纪要整理成要点',
      mockReply: '好的，已为你提炼出 5 条关键结论与 3 项待办……',
      mockInput: '输入消息…',
    },
    integrations: {
      eyebrow: '多工具适配',
      title: '为你的工具链而生',
      desc: '一把 Key，接入主流 AI 编程与办公工具，开箱即用。',
      tools: [
        { name: 'Claude Code', tag: '终端版' },
        { name: 'Codex', tag: '桌面版' },
        { name: 'Codex', tag: '终端版' },
        { name: 'OpenClaw', tag: '一站接入' },
        { name: 'WorkBuddy', tag: '办公助手' },
        { name: '更多工具', tag: '敬请期待', soon: true },
      ],
    },
    pricing: {
      eyebrow: '按量付费',
      title: '用多少，付多少',
      desc: '透明计费，无订阅、无门槛。Stripe 安全支付，随时充值、随时导出账单。',
      cta: '购买额度',
    },
    closing: {
      title: '让每个人都享受普惠的 AI 科技',
      desc: '官方直连的稳定，按量付费的自由 —— 几分钟即可开始。',
      cta: '立即使用',
    },
    slogan: '让每个人都享受普惠的 AI 科技',
  },
  en: {
    nav: { models: 'Models', features: 'Features', console: 'Console' },
    hero: {
      badge: 'AnyRouters · One gateway for every model',
      titleLead: 'One API for every ',
      titleGradient: 'frontier model',
      subtitle:
        'AnyRouters routes OpenAI, Anthropic Claude, Google Gemini and AWS Bedrock through a single OpenAI-compatible endpoint — one key, one bill, automatic failover.',
      primaryCta: 'Get started',
      secondaryCta: 'Get API key',
      cardUpstreams: 'Upstreams',
      cardOperational: 'operational',
      cardBalance: 'Balance',
      cardBalanceNote: 'This month · 1.2M tokens',
    },
    workbench: {
      eyebrow: 'Workbench',
      title: 'No setup. Sign in and go.',
      desc: 'A clean chat surface that switches freely between GPT, Claude and Gemini. Smart routing works quietly in the background — you just start.',
      mockModel: 'Claude · Sonnet',
      mockUser: 'Turn these meeting notes into action items',
      mockReply: 'Done — here are 5 key takeaways and 3 action items…',
      mockInput: 'Message…',
    },
    integrations: {
      eyebrow: 'Integrations',
      title: 'Built for your toolchain',
      desc: 'One key, drop-in access to the AI coding and productivity tools you already use.',
      tools: [
        { name: 'Claude Code', tag: 'CLI' },
        { name: 'Codex', tag: 'Desktop' },
        { name: 'Codex', tag: 'CLI' },
        { name: 'OpenClaw', tag: 'One-click' },
        { name: 'WorkBuddy', tag: 'Office' },
        { name: 'More tools', tag: 'Coming soon', soon: true },
      ],
    },
    pricing: {
      eyebrow: 'Pay as you go',
      title: 'Pay only for what you use',
      desc: 'Transparent metering, no subscriptions, no minimums. Secure Stripe payments — top up anytime, export invoices anytime.',
      cta: 'Buy credits',
    },
    closing: {
      title: 'Frontier AI, made accessible to everyone',
      desc: 'The reliability of official upstreams, the freedom of pay-as-you-go — start in minutes.',
      cta: 'Get started',
    },
    slogan: 'Frontier AI, made accessible to everyone',
  },
}
