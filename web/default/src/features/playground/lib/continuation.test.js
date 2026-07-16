import { describe, expect, test } from 'bun:test'
import {
  AUTO_CONTINUATION_PROMPT,
  buildContinuationMessages,
  CONTINUATION_PROMPT,
  shouldAutoContinueSuspiciousStop,
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
})
