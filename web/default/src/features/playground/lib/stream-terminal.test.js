import { describe, expect, test } from 'bun:test'
import {
  canCompleteClosedStream,
  consumeStreamChunk,
  createStreamTerminalState,
} from './stream-terminal'

describe('stream terminal classification', () => {
  test('retains the final text terminal chunk before DONE', () => {
    const state = consumeStreamChunk(createStreamTerminalState(), {
      id: 'req_1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-5.5',
      choices: [
        {
          index: 0,
          delta: { content: 'tail' },
          finish_reason: 'length',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    })

    expect(state.finishReason).toBe('length')
    expect(state.requestId).toBe('req_1')
    expect(state.usage?.total_tokens).toBe(30)
    expect(canCompleteClosedStream(state, false)).toBe(true)
  })

  test('connection close without DONE or finish reason is interrupted', () => {
    const state = consumeStreamChunk(createStreamTerminalState(), {
      id: 'req_2',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-5.5',
      choices: [
        {
          index: 0,
          delta: { content: 'partial' },
          finish_reason: null,
        },
      ],
    })

    expect(canCompleteClosedStream(state, false)).toBe(false)
  })
})
