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
import { describe, expect, test } from 'bun:test'
import { isToolLoopCancelledError, runChatToolLoop } from './chat-tool-loop'

const webSearchCall = (id, query) => ({
  id,
  type: 'function',
  function: { name: 'web_search', arguments: JSON.stringify({ query }) },
})

const payload = () => ({
  model: 'gpt-5.6-sol',
  messages: [{ role: 'user', content: '查询今天行情' }],
  stream: true,
  tools: [{ type: 'function', function: { name: 'web_search' } }],
})

const turn = (overrides = {}) => ({
  content: '',
  toolCalls: [],
  finishReason: 'stop',
  terminationReason: 'stop',
  ...overrides,
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('chat tool loop', () => {
  test('stays active while a web search is pending', async () => {
    const search = deferred()
    const phases = []
    let modelRequests = 0
    let settled = false

    const running = runChatToolLoop({
      payload: payload(),
      requestTurn: async () => {
        modelRequests += 1
        return modelRequests === 1
          ? turn({
              content: '我先查一下。',
              toolCalls: [webSearchCall('call-1', 'A股')],
              finishReason: 'tool_calls',
              terminationReason: 'tool_calls',
            })
          : turn({ content: '最终结论。' })
      },
      searchWeb: async () => search.promise,
      onPhase: (event) => phases.push(event.phase),
    })
    running.finally(() => {
      settled = true
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(phases).toEqual(['requesting', 'searching'])
    expect(modelRequests).toBe(1)
    expect(settled).toBe(false)

    search.resolve({ ok: true, context: '检索结果' })
    const result = await running

    expect(result.content).toBe('我先查一下。\n\n最终结论。')
    expect(modelRequests).toBe(2)
  })

  test('does not request another model turn after aborting a pending search', async () => {
    const search = deferred()
    const controller = new AbortController()
    let modelRequests = 0

    const running = runChatToolLoop({
      payload: payload(),
      signal: controller.signal,
      requestTurn: async () => {
        modelRequests += 1
        return turn({
          toolCalls: [webSearchCall('call-1', 'A股')],
          finishReason: 'tool_calls',
          terminationReason: 'tool_calls',
        })
      },
      searchWeb: async () => search.promise,
    })

    await Promise.resolve()
    await Promise.resolve()
    controller.abort()
    search.resolve({ ok: true, context: '已过期的检索结果' })

    try {
      await running
      throw new Error('expected cancellation')
    } catch (error) {
      expect(isToolLoopCancelledError(error)).toBe(true)
    }
    expect(modelRequests).toBe(1)
  })

  test('automatically continues a GPT-5.6 deferred answer after search', async () => {
    const requests = []
    const continuations = []
    const turns = [
      turn({
        toolCalls: [webSearchCall('call-1', '人工智能板块')],
        finishReason: 'tool_calls',
        terminationReason: 'tool_calls',
      }),
      turn({
        content:
          '已找到今天的有效盘中数据，目前可信数据为沪指+0.62%、深成指+3.41%。我再核对最新收盘/盘中时点和AI细分板块后马上给你完整结论。',
      }),
      turn({ content: '结论：人工智能硬件方向领涨。' }),
    ]

    const result = await runChatToolLoop({
      payload: payload(),
      requestTurn: async (nextPayload) => {
        requests.push(structuredClone(nextPayload.messages))
        return turns.shift()
      },
      searchWeb: async () => ({ ok: true, context: '行情数据' }),
      onContinuation: (event) => continuations.push(event),
    })

    expect(requests).toHaveLength(3)
    expect(requests[2].at(-1).role).toBe('user')
    expect(requests[2].at(-1).content).toContain('本轮直接给出最终回答')
    expect(continuations.map((event) => event.reason)).toEqual(['deferred'])
    expect(result.content).toContain('结论：人工智能硬件方向领涨。')
    expect(result.autoContinuations).toBe(1)
  })

  test('caps deferred auto-continuations at two attempts', async () => {
    let modelRequests = 0

    const result = await runChatToolLoop({
      payload: payload(),
      requestTurn: async () => {
        modelRequests += 1
        if (modelRequests === 1) {
          return turn({
            toolCalls: [webSearchCall('call-1', 'AI行情')],
            finishReason: 'tool_calls',
            terminationReason: 'tool_calls',
          })
        }
        return turn({ content: '我再核对数据后马上给你完整结论。' })
      },
      searchWeb: async () => ({ ok: true, context: '行情数据' }),
    })

    expect(modelRequests).toBe(4)
    expect(result.autoContinuations).toBe(2)
    expect(result.finishReason).toBe('length')
    expect(result.terminationReason).toBe('length')
  })

  test('appends tool results in call order even when searches resolve backwards', async () => {
    const first = deferred()
    const second = deferred()
    const requestPayloads = []
    let modelRequests = 0

    const running = runChatToolLoop({
      payload: payload(),
      requestTurn: async (nextPayload) => {
        modelRequests += 1
        requestPayloads.push(structuredClone(nextPayload.messages))
        return modelRequests === 1
          ? turn({
              toolCalls: [
                webSearchCall('first', '第一个'),
                webSearchCall('second', '第二个'),
              ],
              finishReason: 'tool_calls',
              terminationReason: 'tool_calls',
            })
          : turn({ content: '完成。' })
      },
      searchWeb: (query) =>
        query === '第一个' ? first.promise : second.promise,
    })

    await Promise.resolve()
    await Promise.resolve()
    second.resolve({ ok: true, context: '第二个结果' })
    first.resolve({ ok: true, context: '第一个结果' })
    await running

    const toolMessages = requestPayloads[1].filter(
      (message) => message.role === 'tool'
    )
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual([
      'first',
      'second',
    ])
    expect(toolMessages.map((message) => message.content)).toEqual([
      '第一个结果',
      '第二个结果',
    ])
  })
})
