import { describe, expect, test } from 'bun:test'
import {
  buildContinuationMessages,
  CONTINUATION_PROMPT,
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
        versions: [
          { id: 'v2', content: '这三个产品如果要卖得好，一定要' },
        ],
        status: 'complete',
        finishReason: 'length',
      },
    ]

    const next = buildContinuationMessages(messages, 'a1')

    expect(next).not.toBeNull()
    expect(next).toHaveLength(4)
    expect(next[1].versions[0].content).toBe(
      '这三个产品如果要卖得好，一定要'
    )
    expect(next[2].versions[0].content).toBe(CONTINUATION_PROMPT)
    expect(next[3].from).toBe('assistant')
    expect(next[3].status).toBe('loading')
  })
})
