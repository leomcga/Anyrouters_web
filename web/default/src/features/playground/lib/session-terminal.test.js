import { beforeEach, describe, expect, test } from 'bun:test'
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
    expect(new TextEncoder().encode(restored.versions[0].content).byteLength).toBe(
      32256
    )
  })
})
