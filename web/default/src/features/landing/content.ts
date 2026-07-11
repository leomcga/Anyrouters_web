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
 * Kept self-contained while the marketing page is still iterating. The page
 * reads the current i18n language and swaps this copy without touching the
 * product console translations.
 */

export interface ProviderItem {
  name: string
  icon: string
}

export interface ToolItem {
  name: string
  desc: string
  icon: string
  tags: string[]
}

export interface FeatureItem {
  title: string
  desc: string
}

export interface FlowItem {
  title: string
  desc: string
}

export interface ControlItem {
  title: string
  desc: string
}

export interface LandingCopy {
  nav: {
    features: string
    models: string
    docs: string
    about: string
    login: string
    register: string
    console: string
  }
  hero: {
    label: string
    titleLines: string[]
    subtitle: string
    primaryCta: string
    secondaryCta: string
    baseLabel: string
    copyBase: string
    consoleLabel: string
    consoleStatus: string
    consoleTabs: string[]
    codeTitle: string
    codeComment: string
    modelPanelTitle: string
    modelPanelDesc: string
    walletPanelTitle: string
    walletPanelDesc: string
  }
  providers: {
    label: string
    items: ProviderItem[]
  }
  features: {
    label: string
    title: string
    desc: string
    items: FeatureItem[]
  }
  quick: {
    label: string
    title: string
    desc: string
    prompt: string
    reply: string
    steps: FeatureItem[]
  }
  tools: {
    label: string
    title: string
    desc: string
    items: ToolItem[]
  }
  billing: {
    label: string
    title: string
    desc: string
    cta: string
    points: string[]
  }
  control: {
    label: string
    title: string
    desc: string
    signals: string[]
    items: ControlItem[]
  }
  flow: {
    label: string
    title: string
    desc: string
    items: FlowItem[]
  }
  closing: {
    title: string
    desc: string
    cta: string
  }
  slogan: string
}

const providers: ProviderItem[] = [
  { name: 'OpenAI', icon: 'OpenAI' },
  { name: 'Claude', icon: 'Claude.Color' },
  { name: 'Gemini', icon: 'Gemini.Color' },
]

export const landingContent: Record<'zh' | 'en', LandingCopy> = {
  zh: {
    nav: {
      features: '能力',
      models: '模型广场',
      docs: '文档',
      about: '关于',
      login: '登录',
      register: '注册',
      console: '控制台',
    },
    hero: {
      label: 'AnyRouters · 一个网关，调用所有模型',
      titleLines: ['一个 API，', '调用所有前沿大模型'],
      subtitle:
        'AnyRouters 用 api.anyrouters.com 统一承接 OpenAI、Anthropic Claude 与 Google Gemini 调用。用户只需替换 Base URL 和 Key，按需指定模型，调用、余额与账单都在控制台记录。',
      primaryCta: '立即使用',
      secondaryCta: '获取 API Key',
      baseLabel: '统一 API Base URL',
      copyBase: '复制 Base URL',
      consoleLabel: 'AnyRouters Console',
      consoleStatus: '网关概览',
      consoleTabs: ['Overview', 'Routing', 'Usage', 'Billing'],
      codeTitle: 'request.ts',
      codeComment: '替换 Base URL 和 Key 即可调用',
      modelPanelTitle: '可调用模型',
      modelPanelDesc: '用户在请求参数或模型广场中选择目标模型。',
      walletPanelTitle: '用量与账单',
      walletPanelDesc: '充值、调用与消耗记录清晰归档。',
    },
    providers: {
      label: '当前接入模型供应商',
      items: providers,
    },
    features: {
      label: '网关架构',
      title: '用 AnyRouters API 调用聚合模型',
      desc: '用户请求 AnyRouters 提供的 API，就可以调用平台聚合的 OpenAI、Claude、Gemini 等模型，并在控制台查看 Key、额度、可用模型、用量日志和账单。',
      items: [
        {
          title: 'AnyRouters API 聚合模型',
          desc: '用户调用 AnyRouters API，并在请求里指定目标模型；平台负责把请求送到已接入的模型通道。',
        },
        {
          title: '密钥与额度管理',
          desc: '用户可自助创建 API Key，查看额度、到期状态和调用记录。',
        },
        {
          title: 'Stripe 安全支付链路',
          desc: '充值、订单和 webhook 由服务端统一处理，支付结果与余额变动清晰可查。',
        },
        {
          title: '用量统计与账单追踪',
          desc: '按账号、模型和渠道记录 tokens、费用与调用日志，个人和团队都能准确对账。',
        },
        {
          title: '平台侧模型通道治理',
          desc: '模型供应商接入、通道状态和调用日志由平台侧维护，用户侧只面对 AnyRouters API。',
        },
        {
          title: '面向生产的安全边界',
          desc: '密钥不进前端、不进 Git；支付密钥和 webhook secret 仅保留在服务端密钥系统。',
        },
      ],
    },
    quick: {
      label: '在线使用',
      title: '在 AnyRouters 里直接调用聚合模型',
      desc: '除了 API 接入，用户也可以在控制台的聊天区域直接选择模型，进行对话、图片生成和视频生成等任务。每次调用都会进入用量和账单记录。',
      prompt: '用 Claude 把这段客服对话总结成三条待办。',
      reply:
        '已调用用户选择的聚合模型完成对话任务，并记录本次 tokens、费用和调用时间。',
      steps: [
        {
          title: '选择模型',
          desc: '在聊天区域选择 OpenAI、Claude 或 Gemini。',
        },
        { title: '输入任务', desc: '支持对话、图片生成、视频生成等使用场景。' },
        { title: '查看消耗', desc: '每次调用的用量、费用和记录都可追踪。' },
      ],
    },
    tools: {
      label: '工具链适配',
      title: '一把 Key，接入常用 AI 工具链',
      desc: '本地 IDE、Agent CLI、低代码 AI 应用和团队后端服务都可以请求 AnyRouters API，调用记录统一进入控制台。',
      items: [
        {
          name: 'OpenAI SDK',
          desc: 'Node / Python / Go',
          icon: 'OpenAI',
          tags: ['SDK', 'Base URL'],
        },
        {
          name: 'Claude Code',
          desc: '终端工作流',
          icon: 'ClaudeCode.Color',
          tags: ['CLI', 'Agent'],
        },
        {
          name: 'Codex',
          desc: '桌面与命令行',
          icon: 'Codex.Color',
          tags: ['Desktop', 'CLI'],
        },
        {
          name: 'Cursor',
          desc: 'IDE 插件',
          icon: 'Cursor',
          tags: ['IDE', '补全'],
        },
        {
          name: 'LangChain',
          desc: 'Agent 编排',
          icon: 'LangChain.Color',
          tags: ['Agent', 'Workflow'],
        },
        {
          name: 'Vercel AI SDK',
          desc: '前端 AI 应用',
          icon: 'Vercel',
          tags: ['React', 'Serverless'],
        },
      ],
    },
    billing: {
      label: '按量付费',
      title: '用多少，付多少',
      desc: '透明计费，无订阅、无门槛。Stripe 安全支付，随时充值，随时导出账单。',
      cta: '购买额度',
      points: ['Stripe 安全支付', '用量账单清晰', '调用记录可追溯'],
    },
    control: {
      label: '账户与计费',
      title: '支付、用量、账单都清楚',
      desc: '从充值到模型调用，支付记录、用量日志和 API Key 分层管理，个人与团队都能随时核对每一笔消耗。',
      signals: ['统一入口', 'Stripe 支付', '用量账单', '密钥管理'],
      items: [
        {
          title: '统一产品入口',
          desc: '官网、控制台和 API 入口保持一致的接入体验',
        },
        {
          title: '安全支付',
          desc: 'Stripe 支付链路由服务端处理，充值与订单清晰归档',
        },
        {
          title: '用量可追踪',
          desc: '按账号、模型和时间记录调用与费用消耗',
        },
        {
          title: '账单对账',
          desc: '个人与团队都能按记录核对充值和模型消耗',
        },
      ],
    },
    flow: {
      label: '使用流程',
      title: '个人接入，团队运营',
      desc: '个人开发者可以快速开始调用；团队用户可以把调用、充值和账单归因到清晰记录。',
      items: [
        {
          title: '接入网关',
          desc: '把应用请求发送到 AnyRouters API 入口，并使用 AnyRouters Key 鉴权。',
        },
        {
          title: '创建 API Key',
          desc: '个人自助生成 Key；团队场景可为不同业务创建独立调用凭证。',
        },
        {
          title: '调用合适模型',
          desc: '在请求参数里指定需要的模型，通过 AnyRouters API 调用平台聚合的模型能力。',
        },
        {
          title: '查看用量账单',
          desc: '个人看清每次消耗；团队按账号、Key 或业务线对账。',
        },
      ],
    },
    closing: {
      title: '让每个 AI 产品都拥有稳定、普惠的模型网关',
      desc: '官方直连的稳定，按量付费的自由，几分钟即可开始。',
      cta: '立即使用',
    },
    slogan: '一个 API，调用所有前沿大模型',
  },
  en: {
    nav: {
      features: 'Features',
      models: 'Models',
      docs: 'Docs',
      about: 'About',
      login: 'Sign in',
      register: 'Sign up',
      console: 'Console',
    },
    hero: {
      label: 'AnyRouters · one gateway for every model',
      titleLines: ['One API', 'for frontier models'],
      subtitle:
        'AnyRouters receives OpenAI, Anthropic Claude and Google Gemini calls through api.anyrouters.com. Users replace the Base URL and key, choose the model they need, and keep calls, balance and billing visible in the console.',
      primaryCta: 'Open console',
      secondaryCta: 'Create API key',
      baseLabel: 'Unified API Base URL',
      copyBase: 'Copy Base URL',
      consoleLabel: 'AnyRouters Console',
      consoleStatus: 'Gateway overview',
      consoleTabs: ['Overview', 'Routing', 'Usage', 'Billing'],
      codeTitle: 'request.ts',
      codeComment: 'Replace Base URL and key to call models.',
      modelPanelTitle: 'Available models',
      modelPanelDesc:
        'Users choose the target model in requests or the model catalog.',
      walletPanelTitle: 'Usage & billing',
      walletPanelDesc: 'Top-ups, calls and spend records stay easy to review.',
    },
    providers: {
      label: 'Currently connected model providers',
      items: providers,
    },
    features: {
      label: 'Gateway architecture',
      title: 'Call aggregated models through the AnyRouters API',
      desc: 'Users call the API provided by AnyRouters to access aggregated OpenAI, Claude and Gemini models, then review keys, quota, available models, usage logs and billing in the console.',
      items: [
        {
          title: 'AnyRouters API for aggregated models',
          desc: 'Users call the AnyRouters API and set the target model in the request; the platform sends it to connected model channels.',
        },
        {
          title: 'Keys and quota',
          desc: 'Users create API keys and review quota, expiry and call records.',
        },
        {
          title: 'Secure Stripe payment path',
          desc: 'Top-ups, orders and webhooks are handled server-side with clear payment and balance records.',
        },
        {
          title: 'Usage and billing traceability',
          desc: 'Tokens, costs and request logs are recorded by account, model and channel for accurate reconciliation.',
        },
        {
          title: 'Platform-side channel governance',
          desc: 'Provider access, channel status and request logs are maintained by the platform while users face only the AnyRouters API.',
        },
        {
          title: 'Production security boundary',
          desc: 'Secrets stay out of the frontend and Git; payment keys and webhook secrets remain server-side only.',
        },
      ],
    },
    quick: {
      label: 'Online use',
      title: 'Use aggregated models directly inside AnyRouters.',
      desc: 'Beyond API access, users can choose models in the console chat area for conversation, image generation and video generation tasks. Every call is recorded for usage and billing.',
      prompt:
        'Use Claude to summarize this support thread into three action items.',
      reply:
        'The selected aggregated model completed the task, with tokens, cost and call time recorded.',
      steps: [
        {
          title: 'Choose a model',
          desc: 'Select OpenAI, Claude or Gemini in the chat area.',
        },
        {
          title: 'Enter a task',
          desc: 'Use chat, image generation, video generation and more.',
        },
        {
          title: 'Review usage',
          desc: 'Every call keeps traceable usage, cost and records.',
        },
      ],
    },
    tools: {
      label: 'Toolchain ready',
      title: 'One key for common AI tooling',
      desc: 'IDEs, agent CLIs, low-code AI apps and backend services can call the AnyRouters API, with request logs unified in the console.',
      items: [
        {
          name: 'OpenAI SDK',
          desc: 'Node / Python / Go',
          icon: 'OpenAI',
          tags: ['SDK', 'Base URL'],
        },
        {
          name: 'Claude Code',
          desc: 'Terminal workflow',
          icon: 'ClaudeCode.Color',
          tags: ['CLI', 'Agent'],
        },
        {
          name: 'Codex',
          desc: 'Desktop and CLI',
          icon: 'Codex.Color',
          tags: ['Desktop', 'CLI'],
        },
        {
          name: 'Cursor',
          desc: 'IDE plugin',
          icon: 'Cursor',
          tags: ['IDE', 'Autocomplete'],
        },
        {
          name: 'LangChain',
          desc: 'Agent framework',
          icon: 'LangChain.Color',
          tags: ['Agent', 'Workflow'],
        },
        {
          name: 'Vercel AI SDK',
          desc: 'Frontend AI apps',
          icon: 'Vercel',
          tags: ['React', 'Serverless'],
        },
      ],
    },
    billing: {
      label: 'Pay as you go',
      title: 'Pay only for what you use',
      desc: 'Transparent metering with no subscription gate. Stripe payments, top-ups and billing exports are available when needed.',
      cta: 'Buy credits',
      points: ['Stripe payments', 'Clear usage ledger', 'Traceable requests'],
    },
    control: {
      label: 'Accounts & billing',
      title: 'Clear payments, usage and billing',
      desc: 'From top-up to model call, payment records, usage logs and API keys are managed in clear layers for individuals and teams.',
      signals: [
        'Unified entry',
        'Stripe payments',
        'Usage ledger',
        'Key management',
      ],
      items: [
        {
          title: 'Unified product entry',
          desc: 'Website, console and API domains provide a consistent access experience.',
        },
        {
          title: 'Secure payments',
          desc: 'Stripe payments are handled server-side with clean top-up and order records.',
        },
        {
          title: 'Traceable usage',
          desc: 'Calls and cost are recorded by account, model and time.',
        },
        {
          title: 'Billing reconciliation',
          desc: 'Individuals and teams can reconcile top-ups and model spend from traceable records.',
        },
      ],
    },
    flow: {
      label: 'Workflow',
      title: 'Individuals connect, teams operate',
      desc: 'Individual developers can start quickly. Teams can attribute calls, top-ups and bills to clear records.',
      items: [
        {
          title: 'Connect the gateway',
          desc: 'Send application requests to the AnyRouters API entry point and authenticate with an AnyRouters key.',
        },
        {
          title: 'Create API keys',
          desc: 'Individuals create keys by themselves; teams can keep separate credentials for different workloads.',
        },
        {
          title: 'Call suitable models',
          desc: 'Set the model in the request and call aggregated model capabilities through the AnyRouters API.',
        },
        {
          title: 'Review usage and bills',
          desc: 'Individuals see each spend; teams reconcile by account, key or business line.',
        },
      ],
    },
    closing: {
      title: 'Give every AI product a stable and accessible model gateway',
      desc: 'Official-path stability, pay-as-you-go freedom, and a setup that starts in minutes.',
      cta: 'Get started',
    },
    slogan: 'One API for every frontier model',
  },
}
