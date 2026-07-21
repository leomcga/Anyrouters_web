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
import { beforeEach, describe, expect, mock, test } from 'bun:test'

class FakeSSE {
  static instances = []

  readyState = 1
  status = 200
  closeCount = 0
  listeners = new Map()

  constructor() {
    FakeSSE.instances.push(this)
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? []
    handlers.push(handler)
    this.listeners.set(type, handlers)
  }

  stream() {}

  close() {
    this.closeCount += 1
    this.readyState = 2
  }

  emit(type, event) {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }

  message(data) {
    this.emit('message', { data })
  }
}

const react = await import('react')
mock.module('react', () => ({
  ...react,
  useCallback: (callback) => callback,
  useRef: (initialValue) => ({ current: initialValue }),
}))
mock.module('sse.js', () => ({ SSE: FakeSSE }))

const { useStreamRequest } = await import('./use-stream-request')

const payload = {
  model: 'gpt-test',
  messages: [{ role: 'user', content: 'hello' }],
  stream: true,
}

describe('useStreamRequest stream ownership', () => {
  beforeEach(() => {
    FakeSSE.instances = []
  })

  test('an older stream completing cannot prevent the current stream from completing', () => {
    const streamRequest = useStreamRequest()
    let firstCompletions = 0
    let secondCompletions = 0

    streamRequest.sendStreamRequest(
      payload,
      () => {},
      () => {
        firstCompletions += 1
      },
      () => {}
    )
    const first = FakeSSE.instances[0]

    streamRequest.sendStreamRequest(
      payload,
      () => {},
      () => {
        secondCompletions += 1
      },
      () => {}
    )
    const second = FakeSSE.instances[1]

    first.message('[DONE]')
    second.message('[DONE]')

    expect(firstCompletions).toBe(1)
    expect(secondCompletions).toBe(1)
    expect(first.closeCount).toBe(1)
    expect(second.closeCount).toBe(1)
  })

  test('events arriving after stop are ignored', () => {
    const streamRequest = useStreamRequest()
    const updates = []
    let completions = 0
    let errors = 0

    streamRequest.sendStreamRequest(
      payload,
      (_type, chunk) => updates.push(chunk),
      () => {
        completions += 1
      },
      () => {
        errors += 1
      }
    )
    const source = FakeSSE.instances[0]

    streamRequest.stopStream()
    source.message(
      JSON.stringify({
        choices: [{ delta: { content: 'late content' } }],
      })
    )
    source.message('[DONE]')
    source.emit('error', { data: 'late error' })

    expect(updates).toEqual([])
    expect(completions).toBe(0)
    expect(errors).toBe(0)
    expect(source.closeCount).toBe(1)
  })

  test('keeps provider error codes separate from transport termination', () => {
    const streamRequest = useStreamRequest()
    let receivedCode
    let partial

    streamRequest.sendStreamRequest(
      payload,
      () => {},
      () => {},
      (_message, code, result) => {
        receivedCode = code
        partial = result
      }
    )
    const source = FakeSSE.instances[0]
    source.emit('error', {
      data: JSON.stringify({
        error: { message: 'unsupported endpoint', code: 'invalid_request' },
      }),
    })

    expect(receivedCode).toBe('invalid_request')
    expect(partial.terminationReason).toBe('network_error')
  })

  test('settles an error delivered after the source is already closed', () => {
    const streamRequest = useStreamRequest()
    let errors = 0

    streamRequest.sendStreamRequest(
      payload,
      () => {},
      () => {},
      () => {
        errors += 1
      }
    )
    const source = FakeSSE.instances[0]
    source.readyState = 2
    source.emit('error', { data: 'connection failed' })

    expect(errors).toBe(1)
    expect(source.closeCount).toBe(1)
  })
})
