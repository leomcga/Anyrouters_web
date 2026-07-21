import { beforeEach, describe, expect, test } from 'bun:test'
import { markGenerationActive, markGenerationDone } from './active-generations'
import {
  appendTerminalError,
  finalizeMessage,
  sanitizeMessagesOnLoad,
} from './message-utils'
import {
  createSession,
  loadSessions,
  patchSessionMessage,
  saveSessions,
} from './sessions'

class MemoryStorage {
  values = new Map()

  getItem(key) {
    return this.values.get(key) ?? null
  }

  setItem(key, value) {
    this.values.set(key, String(value))
  }

  removeItem(key) {
    this.values.delete(key)
  }
}

describe('stream terminal persistence', () => {
  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage()
  })

  test('persists the exact final text and length metadata across reload', () => {
    const text = '产品定位、渠道匹配和持续复购必须形成闭环。'.repeat(512)
    const session = createSession([
      {
        key: 'assistant-1',
        from: 'assistant',
        versions: [{ id: 'v1', content: '' }],
        status: 'streaming',
      },
    ])
    saveSessions([session])

    patchSessionMessage(session.id, 'assistant-1', {
      content: text,
      status: 'complete',
      isReasoningStreaming: false,
      isReasoningComplete: true,
      isContentComplete: true,
      isSearching: false,
      finishReason: 'length',
      terminationReason: 'length',
      requestId: 'req-controlled-gpt55',
      usage: {
        prompt_tokens: 100,
        completion_tokens: 200,
        total_tokens: 300,
      },
    })

    const restored = loadSessions()[0].messages[0]
    expect(restored.versions[0].content).toBe(text)
    expect(restored.finishReason).toBe('length')
    expect(restored.requestId).toBe('req-controlled-gpt55')
    expect(restored.usage.total_tokens).toBe(300)
    expect(restored.isReasoningStreaming).toBe(false)
    expect(restored.isReasoningComplete).toBe(true)
    expect(restored.isContentComplete).toBe(true)
    expect(restored.isSearching).toBe(false)
    expect(
      new TextEncoder().encode(restored.versions[0].content).byteLength
    ).toBe(32256)
  })

  test('an older async offload cannot overwrite a newer terminal snapshot', async () => {
    let resolveOldOffload
    let resolveLatestOffload
    const oldOffload = new Promise((resolve) => {
      resolveOldOffload = resolve
    })
    const latestOffload = new Promise((resolve) => {
      resolveLatestOffload = resolve
    })

    const oldSession = createSession([
      {
        key: 'assistant-revision',
        from: 'assistant',
        versions: [{ id: 'v1', content: '旧的流式快照' }],
        status: 'streaming',
        isReasoningStreaming: true,
        isContentComplete: false,
      },
    ])
    saveSessions([oldSession], () => oldOffload)

    const latestSession = {
      ...oldSession,
      updatedAt: oldSession.updatedAt + 1,
      messages: [
        {
          ...oldSession.messages[0],
          versions: [{ id: 'v1', content: '最新完整回答' }],
          status: 'complete',
          isReasoningStreaming: false,
          isReasoningComplete: true,
          isContentComplete: true,
          isSearching: false,
        },
      ],
    }
    saveSessions([latestSession], () => latestOffload)

    const latestOffloadedMessages = latestSession.messages.map((message) => ({
      ...message,
      versions: [{ id: 'v1', content: '最新完整回答（已转存）' }],
    }))
    resolveLatestOffload(latestOffloadedMessages)
    await latestOffload
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(loadSessions()[0].messages[0].versions[0].content).toBe(
      '最新完整回答（已转存）'
    )

    // Complete the older offload last. Before the revision guard this late
    // callback rewrote localStorage with the stale streaming message.
    resolveOldOffload(oldSession.messages)
    await oldOffload
    await new Promise((resolve) => setTimeout(resolve, 0))

    const restored = loadSessions()[0].messages[0]
    expect(restored.versions[0].content).toBe('最新完整回答（已转存）')
    expect(restored.status).toBe('complete')
    expect(restored.isReasoningStreaming).toBe(false)
    expect(restored.isContentComplete).toBe(true)
  })

  test('repairs terminal messages whose old reasoning flags are still active', () => {
    const session = createSession([
      {
        key: 'assistant-stale',
        from: 'assistant',
        versions: [{ id: 'v1', content: '部分回答' }],
        reasoning: { content: '仍显示正在生成', duration: 0 },
        status: 'error',
        terminationReason: 'network_error',
        isReasoningStreaming: true,
        isReasoningComplete: false,
        isContentComplete: false,
        isSearching: true,
      },
    ])
    saveSessions([session])

    const restored = loadSessions()[0].messages[0]
    expect(restored.status).toBe('error')
    expect(restored.isReasoningStreaming).toBe(false)
    expect(restored.isReasoningComplete).toBe(true)
    expect(restored.isContentComplete).toBe(true)
    expect(restored.isSearching).toBe(false)
  })

  test('finalization closes every transient UI flag', () => {
    const finalized = finalizeMessage({
      key: 'assistant-final',
      from: 'assistant',
      versions: [{ id: 'v1', content: '最终回答' }],
      status: 'streaming',
      isReasoningStreaming: true,
      isReasoningComplete: false,
      isContentComplete: false,
      isSearching: true,
    })

    expect(finalized.isReasoningStreaming).toBe(false)
    expect(finalized.isReasoningComplete).toBe(true)
    expect(finalized.isContentComplete).toBe(true)
    expect(finalized.isSearching).toBe(false)
  })

  test('an error bubble always keeps a useful terminal message', () => {
    expect(appendTerminalError('', 'HTTP 502: upstream unavailable')).toBe(
      'HTTP 502: upstream unavailable'
    )
    expect(appendTerminalError('已核对两个来源。', '请求失败，请重试。')).toBe(
      '已核对两个来源。\n\n请求失败，请重试。'
    )
    expect(appendTerminalError('', 'Generation was interrupted')).toBe(
      'Generation was interrupted'
    )
  })

  test('repairs every inactive loading or streaming assistant message', () => {
    const restored = sanitizeMessagesOnLoad([
      {
        key: 'assistant-loading',
        from: 'assistant',
        versions: [{ id: 'v1', content: '' }],
        status: 'loading',
        isSearching: true,
      },
      {
        key: 'user-between',
        from: 'user',
        versions: [{ id: 'v1', content: '继续' }],
      },
      {
        key: 'assistant-streaming',
        from: 'assistant',
        versions: [{ id: 'v1', content: '部分回答' }],
        status: 'streaming',
        isReasoningStreaming: true,
      },
    ])

    expect(restored[0].status).toBe('error')
    expect(restored[0].versions[0].content).toContain('interrupted')
    expect(restored[0].isReasoningComplete).toBe(true)
    expect(restored[0].isContentComplete).toBe(true)
    expect(restored[0].isSearching).toBe(false)
    expect(restored[1].status).toBeUndefined()
    expect(restored[2].status).toBe('error')
    expect(restored[2].versions[0].content).toBe('部分回答')
    expect(restored[2].isReasoningStreaming).toBe(false)
    expect(restored[2].isReasoningComplete).toBe(true)
    expect(restored[2].isContentComplete).toBe(true)
  })

  test('preserves a detached generation that is still genuinely active', () => {
    const activeMessage = {
      key: 'assistant-active-image',
      from: 'assistant',
      versions: [{ id: 'v1', content: '' }],
      status: 'loading',
      isContentComplete: false,
    }

    markGenerationActive(activeMessage.key)
    try {
      const restored = sanitizeMessagesOnLoad([activeMessage])
      expect(restored[0]).toBe(activeMessage)
      expect(restored[0].status).toBe('loading')
      expect(restored[0].isContentComplete).toBe(false)
    } finally {
      markGenerationDone(activeMessage.key)
    }
  })
})
