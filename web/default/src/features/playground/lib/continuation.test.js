import { describe, expect, test } from 'bun:test'
import {
  AUTO_CONTINUATION_PROMPT,
  AUTO_TOOL_CONTINUATION_PROMPT,
  buildContinuationMessages,
  CONTINUATION_PROMPT,
  shouldAutoContinueSuspiciousStop,
  shouldAutoContinueToolAnswer,
} from './continuation'

describe('continue generation payload', () => {
  test('keeps full context and adds one non-repeating continuation turn', () => {
    const messages = [
      {
        key: 'u1',
        from: 'user',
        versions: [{ id: 'v1', content: '请详细分析三个产品' }],
      },
      {
        key: 'a1',
        from: 'assistant',
        versions: [{ id: 'v2', content: '这三个产品如果要卖得好，一定要' }],
        status: 'complete',
        finishReason: 'length',
      },
    ]

    const next = buildContinuationMessages(messages, 'a1')

    expect(next).not.toBeNull()
    expect(next).toHaveLength(4)
    expect(next[1].versions[0].content).toBe('这三个产品如果要卖得好，一定要')
    expect(next[2].versions[0].content).toBe(CONTINUATION_PROMPT)
    expect(next[3].from).toBe('assistant')
    expect(next[3].status).toBe('loading')
  })

  test('auto-continues a long GPT-5.5 reply falsely stopped mid-sentence', () => {
    expect(
      shouldAutoContinueSuspiciousStop({
        model: 'gpt-5.5',
        content: `${'完整段落。'.repeat(400)}如果其应用涉及垃圾营销、仿冒`,
        finishReason: 'stop',
      })
    ).toBe(true)
    expect(AUTO_CONTINUATION_PROMPT).toContain('不要重复')
  })

  test('does not auto-continue genuine terminal states or complete endings', () => {
    const complete = `${'完整段落。'.repeat(400)}最后，以上方案可以分阶段落地。`

    expect(
      shouldAutoContinueSuspiciousStop({
        model: 'gpt-5.5',
        content: complete,
        finishReason: 'stop',
      })
    ).toBe(false)
    expect(
      shouldAutoContinueSuspiciousStop({
        model: 'gpt-5.5',
        content: `${complete.slice(0, -1)}仍未结束`,
        finishReason: 'length',
      })
    ).toBe(false)
    expect(
      shouldAutoContinueSuspiciousStop({
        model: 'claude-opus-4-8',
        content: `${complete.slice(0, -1)}仍未结束`,
        finishReason: 'stop',
      })
    ).toBe(false)
  })

  test('does not continue short chat or closed structured output', () => {
    expect(
      shouldAutoContinueSuspiciousStop({
        model: 'gpt-5.5',
        content: '可以',
        finishReason: 'stop',
      })
    ).toBe(false)
    expect(
      shouldAutoContinueSuspiciousStop({
        model: 'gpt-5.5',
        content: `${'说明。'.repeat(700)}\n\n\`\`\`json\n{"ok": true}\n\`\`\``,
        finishReason: 'stop',
      })
    ).toBe(false)
  })

  test('auto-continues a deferred GPT-5.6 answer after web search', () => {
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content: '我再核对最新收盘/盘中时点和AI细分板块后马上给你完整结论。',
        finishReason: 'stop',
        searchRounds: 2,
      })
    ).toBe(true)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content:
          '我先继续核对指数点位、成交额、涨跌家数以及人工智能不同口径的表现。',
        finishReason: 'stop',
        searchRounds: 1,
      })
    ).toBe(true)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content:
          '已找到今天（2026年7月21日）的有效盘中数据。刚才搜索结果混入了7月8日和2025年7月21日的数据，我正在剔除错配；目前可信的午间行情是：沪指3819.66（+0.62%）、深成指14074.22（+3.41%）、创业板指3622.27（+5.20%）、科创50为1837.94（+6.94%）。我再核对最新收盘/盘中时点和AI细分板块后马上给你完整结论。',
        finishReason: 'stop',
        searchRounds: 2,
      })
    ).toBe(true)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content:
          '我会把“指数点位/涨跌幅”“成交额与市场广度”“AI概念及其细分方向”分开核验，避免把搜索摘要中的旧行情或盘中数据误当成收盘数据。继续查交易所、行情平台和财经快讯。',
        finishReason: 'stop',
        searchRounds: 1,
      })
    ).toBe(true)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content:
          '我将把指数点位、成交额和AI板块分别核对，避免误用旧数据。再查交易所公告和行情平台。',
        finishReason: 'stop',
        searchRounds: 1,
      })
    ).toBe(true)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content:
          '我已确认当前为7月21日收盘后，因此以下按“今日收盘行情”分析；我会继续核对成交额、涨跌家数、AI细分方向和代表股，避免把午盘数据或不同平台的板块口径混在一起。',
        finishReason: 'stop',
        searchRounds: 1,
      })
    ).toBe(true)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content:
          '我已确认当前为7月21日收盘后，因此以下按“今日收盘行情”分析；我会继续核对沪指上涨0.62%是否为午盘数据，避免误用。',
        finishReason: 'stop',
        searchRounds: 1,
      })
    ).toBe(true)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content:
          '我已确认当前为7月21日收盘后，所以以下按“今日收盘行情”口径；我会继续核对AI硬件领涨是否属于不同平台口径差异。',
        finishReason: 'stop',
        searchRounds: 1,
      })
    ).toBe(true)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content:
          '我已确认当前为7月21日收盘后，因此以下按今日收盘行情分析；我会继续核对AI硬件是否领涨。',
        finishReason: 'stop',
        searchRounds: 1,
      })
    ).toBe(true)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content:
          '我已确认当前为7月21日收盘后，因此以下按今日收盘行情分析；我会继续核对市场是否走强、应用端是否分化。',
        finishReason: 'stop',
        searchRounds: 1,
      })
    ).toBe(true)
    for (const content of [
      '我还需要继续核对成交额。',
      '接下来我会继续核对成交额。',
      '接下来，我会继续核对成交额。',
      '我仍需核对成交额。',
      '我仍会继续核对成交额。',
      '初步搜索已完成；我会继续核对三个来源后给出最终结论。',
      '初步搜索已完成，我会继续核对三个来源后给出最终结论。',
      '已找到今天的有效盘中数据，目前可信数据为沪指+0.62%、深成指+3.41%。我再核对最新收盘/盘中时点和AI细分板块后马上给你完整结论。',
      '搜索已完成；我会继续核对三个来源后给出最终结论。',
      '核验已经完成；我会继续核对三个来源后给出最终结论。',
      '数据已经确认有效；我会继续核对三个来源后给出最终结论。',
      '行情数据可信；我会继续核对三个来源后给出最终结论。',
      '沪指上涨0.62%；我再核对后马上给你完整结论。',
      '沪指上涨0.62%，我再核对后马上给你完整结论。',
      'I’ll continue to verify the turnover data.',
      "Preliminary search is complete. I'll continue to verify three sources, then provide the final answer.",
      "Preliminary search is complete, I'll continue to verify three sources, then provide the final answer.",
      'Search is complete; I will verify three sources and provide the final answer.',
      'The data is reliable; I will verify three sources and provide the final answer.',
      'Verification is complete; I will verify three sources and provide the final answer.',
    ]) {
      expect(
        shouldAutoContinueToolAnswer({
          model: 'gpt-5.6-sol',
          content,
          finishReason: 'stop',
          searchRounds: 1,
        })
      ).toBe(true)
    }
    expect(AUTO_TOOL_CONTINUATION_PROMPT).toContain('本轮直接给出最终回答')
  })

  test('does not auto-continue without a prior search or after a final answer', () => {
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content: '我再核对后给你完整结论。',
        finishReason: 'stop',
        searchRounds: 0,
      })
    ).toBe(false)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content: '结论：今天人工智能硬件方向领涨，应用端分化。',
        finishReason: 'stop',
        searchRounds: 2,
      })
    ).toBe(false)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content: '我再核对了三家来源，数据一致：沪指上涨。',
        finishReason: 'stop',
        searchRounds: 2,
      })
    ).toBe(false)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content: "I'll verify: all three sources agree; the index is up 0.62%.",
        finishReason: 'stop',
        searchRounds: 2,
      })
    ).toBe(false)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content:
          '继续核对后的结论：三家来源一致，沪指上涨0.62%，人工智能硬件方向领涨。',
        finishReason: 'stop',
        searchRounds: 2,
      })
    ).toBe(false)

    for (const content of [
      '继续查交易所、行情平台和财经快讯。',
      '三家数据一致，沪指上涨0.62%。继续查交易所公告。',
      '核验结果：三家来源一致，沪指上涨0.62%。继续查交易所公告可以降低误差。',
      '建议继续查交易所公告，以确认收盘数据。',
      '我会把指数点位和成交额分开呈现：沪指上涨0.62%，AI硬件领涨。',
      '我会查看你的建议，但当前结论是硬件端领涨。',
      '我会查阅这些来源；当前答案是AI硬件端更强。',
      '我会把指数点位、成交额和AI板块分别核对，沪指上涨0.62%。再查交易所公告和行情平台。',
      '我会把指数点位、成交额和AI板块分别核对，当前判断：人工智能硬件方向领涨。继续查交易所公告和行情平台。',
      '我会把指数点位、成交额和AI板块分别核对；人工智能硬件方向领涨。继续查交易所公告和行情平台。',
      '我会把指数点位、成交额和AI板块分别核对，目前确认硬件端更强。继续查交易所公告和行情平台。',
      '我会把指数点位、成交额和AI板块分别核对，三家来源完全吻合。继续查交易所公告和行情平台。',
      '我会把指数点位、成交额和AI板块分别核对，沪指报3819.66点，AI硬件方向更强。继续查交易所公告和行情平台。',
      '我会把指数点位、成交额和AI板块分别核对，已确认人工智能硬件方向更强。继续查交易所公告和行情平台。',
      '我会把指数点位、成交额和AI板块分别核对，综上，人工智能硬件方向更强。继续查交易所公告和行情平台。',
      '我会把指数点位、成交额和AI板块分别核对，避免误用旧数据。AI硬件端更强。继续查交易所公告和行情平台。',
      '我会把指数点位、成交额和AI板块分别核对，防止把旧数据当成收盘数据。沪指报3819.66点。继续查交易所公告。',
      '我会把指数点位、成交额和AI板块分别核对，以免混淆盘中和收盘口径。当前最强的是AI硬件端。继续查交易所公告。',
      '我会把指数点位、成交额和AI板块分别核对，避免误用旧数据，因此AI硬件端更强。继续查交易所公告和行情平台。',
      '我会把指数点位、成交额和AI板块分别核对，避免误用旧数据。继续查交易所公告；结论仍是AI硬件端领涨。',
      '我会把指数点位、成交额和AI板块分别核对，避免误用旧数据。继续查交易所公告，当前AI硬件端更强。',
      '我会把指数点位、成交额和AI板块分别核对，避免误用旧数据。继续查交易所公告；三家来源完全吻合。',
      '结论：AI硬件领涨；我会继续核对后续数据。',
      '三家来源一致，AI硬件领涨；我会继续核对后续数据。',
      '沪指上涨0.62%；我会继续核对后续数据。',
      '当前最强的是AI硬件端；我会继续核对后续数据。',
      'AI硬件领涨；我会继续核对后续数据。',
      '沪指报3819.66点；我会继续核对后续数据。',
      '两市成交额约2万亿元；我会继续核对后续数据。',
      'AI硬件端强于应用端；我会继续核对后续数据。',
      '人工智能硬件方向走强；我会继续核对后续数据。',
      '市场呈现科技主导的结构性行情；我会继续核对后续数据。',
      'AI硬件端占优；我会继续核对后续数据。',
      '我已确认当前为7月21日收盘后，沪指报3819.66点，因此以下按“今日收盘行情”分析；我会继续核对后续数据。',
      "The index is up 0.62%; I'll continue to verify the remaining data.",
      '如果你希望进一步确认，我会继续核对三个来源后给出最终结论。',
      '若想获得更多细节，我会继续核对三个来源后给出最终结论。',
      '如需更详细的数据，我会继续核对三个来源后给出最终结论。',
      '例如，我会继续核对三个来源后给出最终结论。',
      '比如，我会继续核对三个来源后给出最终结论。',
      "If you want more detail, I'll verify three sources and provide the final answer.",
      "Should you need more detail, I'll verify three sources and provide the final answer.",
      "For example, I'll verify three sources and provide a final answer.",
      "E.g., I'll verify three sources and provide a final answer.",
      '初步搜索已完成，如果你希望进一步确认，我会继续核对三个来源后给出最终结论。',
      '初步搜索已完成，但如果你希望进一步确认，我会继续核对三个来源后给出最终结论。',
      '初步搜索已完成，例如，我会继续核对三个来源后给出最终结论。',
      "Preliminary search is complete, but if you want more detail, I'll verify three sources and provide the final answer.",
      "Preliminary search is complete, should you need more detail, I'll verify three sources and provide the final answer.",
      "Preliminary search is complete, for example, I'll verify three sources and provide a final answer.",
      '若有需要，初步搜索已完成，我会继续核对三个来源后给出最终结论。',
      '如有需要，初步搜索已完成，我会继续核对三个来源后给出最终结论。',
      '需要的话，初步搜索已完成，我会继续核对三个来源后给出最终结论。',
      '有需要的话，初步搜索已完成，我会继续核对三个来源后给出最终结论。',
      '必要时，初步搜索已完成，我会继续核对三个来源后给出最终结论。',
      '举例，初步搜索已完成，我会继续核对三个来源后给出最终结论。',
      '示例，初步搜索已完成，我会继续核对三个来源后给出最终结论。',
      '如有需要；我会继续核对三个来源后给出最终结论。',
      'For instance, preliminary search is complete, I will verify three sources and provide the final answer.',
      'As an example, preliminary search is complete, I will verify three sources and provide the final answer.',
      'When needed, preliminary search is complete, I will verify three sources and provide the final answer.',
      'When requested, preliminary search is complete, I will verify three sources and provide the final answer.',
      'For instance; I will verify three sources and provide the final answer.',
      '要是你需要，初步搜索已完成，我会继续核对三个来源后给出最终结论。',
      '这是一个例子，初步搜索已完成，我会继续核对三个来源后给出最终结论。',
      '要是你需要；我会继续核对三个来源后给出最终结论。',
      '万一你需要；我会继续核对三个来源后给出最终结论。',
      '只要你需要；我会继续核对三个来源后给出最终结论。',
      'In case you need it, preliminary search is complete, I will verify three sources and provide the final answer.',
      'By way of example, preliminary search is complete, I will verify three sources and provide the final answer.',
      'As needed, preliminary search is complete, I will verify three sources and provide the final answer.',
      'In case you need it; I will verify three sources and provide the final answer.',
      '当前行情数据已确认有效且AI硬件领涨；我会继续核对三个来源后给出最终结论。',
      '我已确认当前为7月21日收盘后，因此以下按“今日收盘行情”分析；我会继续核对成交额，目前判断AI硬件领涨、应用端分化。',
      '我会把指数点位、成交额和AI板块分别核对，避免把盘中数据误当成收盘数据并确认硬件端占优。继续查交易所公告和行情平台。',
      '初步搜索示范已完成；我会继续核对三个来源后给出最终结论。',
      '如有需要。初步搜索已完成；我会继续核对三个来源后给出最终结论。',
      'The index is up 0.62% and AI hardware leads; I will verify three sources and provide the final answer.',
      'Initial search example is complete; I will verify three sources and provide the final answer.',
      'If needed. Preliminary search is complete; I will verify three sources and provide the final answer.',
      '我会继续核对三个来源后给出最终结论，如果你需要的话。',
      '我会继续核对数据，整体来看AI硬件占优。',
      '我会继续核对if needed AI数据。',
      '我会继续核对 if you want more details 的数据。',
      '我会继续核对 for example 的数据。',
      '我会继续核对 AI hardware is the main theme 的结果。',
      '我会继续核对 recommend buying AI hardware 的内容。',
      '初步搜索已完成；我会继续核对 if you want more details 的数据后给出最终结论。',
      '我已确认当前为7月21日收盘后，因此以下按今日收盘行情分析；我会继续核对 AI hardware is the main theme 的结果。',
      '我会把if needed AI数据分开核验，避免误用旧数据。继续查交易所公告和行情平台。',
      '我会把 AI hardware is the main theme 的结果分别核对，避免误用旧数据。继续查交易所公告和行情平台。',
      '我再核对数据后给你AI硬件领涨的结论。',
      '我再核对数据后给你“AI硬件领涨”的结论。',
      '我再核对数据后给你建议关注AI硬件的结论。',
      '我再核对数据后给你无需继续核对的结论。',
      '我再核对后给你如有需要才看的最终结论。',
      '我再核对后给你示例中的最终结论。',
      '我再核对后给你AI硬件领涨的完整结论。',
      "I'll verify three sources and provide the final answer if you want more detail.",
      "I'll continue to verify, but AI hardware leads.",
      'Search is complete; I will verify three sources and provide the final answer, but AI hardware leads.',
      '假如你还想深入了解。初步搜索已完成；我会继续核对三个来源后给出最终结论。',
      '你愿意的话。初步搜索已完成；我会继续核对三个来源后给出最终结论。',
      '这是例句。初步搜索已完成；我会继续核对三个来源后给出最终结论。',
      '这是样例。初步搜索已完成；我会继续核对三个来源后给出最终结论。',
      '这是例证。初步搜索已完成；我会继续核对三个来源后给出最终结论。',
      'At your request. Preliminary search is complete; I will verify three sources and provide the final answer.',
      'Upon request. Preliminary search is complete; I will verify three sources and provide the final answer.',
      'This is a sample. Preliminary search is complete; I will verify three sources and provide the final answer.',
      '当前行情数据已确认有效且AI硬件是今日主线；我会继续核对三个来源后给出最终结论。',
      '当前行情数据已确认有效且建议关注AI硬件；我会继续核对三个来源后给出最终结论。',
      '已找到结论为AI硬件领涨的有效盘中数据；我会继续核对三个来源后给出最终结论。',
      '已找到证明AI硬件是今日主线的有效盘中数据；我会继续核对三个来源后给出最终结论。',
      '已找到示例中的有效盘中数据；我会继续核对三个来源后给出最终结论。',
      '已找到如有需要才使用的有效盘中数据，目前可信数据为沪指+0.62%、深成指+3.41%。我再核对三个来源后马上给你完整结论。',
      '已找到示例中的有效盘中数据，目前可信数据为沪指+0.62%、深成指+3.41%。我再核对三个来源后马上给你完整结论。',
      '沪指与AI硬件是今日主线相关涨幅0.62%；我再核对三个来源后马上给你完整结论。',
      '我已确认当前为7月21日收盘后，因此以下按“AI硬件领涨的今日收盘行情”分析；我会继续核对成交额。',
      '我已确认当前为7月21日收盘后，因此以下按“建议关注AI硬件的今日收盘行情”分析；我会继续核对成交额。',
      '我已确认当前为7月21日收盘后，因此以下按“示例中的今日收盘行情”分析；我会继续核对成交额。',
      '我已确认当前为7月21日收盘后，因此以下按“如有需要才补充的今日收盘行情”分析；我会继续核对成交额。',
      '我已确认当前为AI硬件领涨后的7月21日收盘后，因此以下按今日收盘行情分析；我会继续核对成交额。',
      '我已确认当前为7月21日收盘后，因此以下按今日收盘行情分析；我会继续核对成交额，但AI硬件是今日主线。',
      '我已确认当前为7月21日收盘后，因此以下按今日收盘行情分析；我会继续核对成交额，但建议关注AI硬件。',
      '我会把指数点位、成交额和AI板块分别核对，避免把盘中数据误当成收盘数据并确认AI硬件是今日主线。继续查交易所公告和行情平台。',
      'Current market data is reliable and AI hardware is the strongest theme. I will verify three sources and provide the final answer.',
    ]) {
      expect(
        shouldAutoContinueToolAnswer({
          model: 'gpt-5.6-sol',
          content,
          finishReason: 'stop',
          searchRounds: 2,
        })
      ).toBe(false)
    }
  })
})
