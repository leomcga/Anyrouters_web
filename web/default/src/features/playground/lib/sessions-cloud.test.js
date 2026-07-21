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
import { createCloudSessionSync } from './sessions-cloud'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createSession(id, content, updatedAt) {
  return {
    id,
    title: id,
    messages: [
      {
        key: `${id}-${content}`,
        from: 'assistant',
        versions: [{ id: 'v1', content }],
        status: content === 'terminal' ? 'complete' : 'streaming',
      },
    ],
    createdAt: 1,
    updatedAt,
  }
}

function createControlledApi() {
  const puts = []
  const deletes = []
  const activeBySession = new Map()
  let maxSameSessionConcurrency = 0

  return {
    puts,
    deletes,
    get maxSameSessionConcurrency() {
      return maxSameSessionConcurrency
    },
    api: {
      put(url, row) {
        const pending = deferred()
        const active = (activeBySession.get(row.id) ?? 0) + 1
        activeBySession.set(row.id, active)
        maxSameSessionConcurrency = Math.max(maxSameSessionConcurrency, active)
        puts.push({ url, row, pending })
        return pending.promise.finally(() => {
          activeBySession.set(row.id, (activeBySession.get(row.id) ?? 1) - 1)
        })
      },
      delete(url) {
        const pending = deferred()
        deletes.push({ url, pending })
        return pending.promise
      },
    },
  }
}

async function nextTurn() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('cloud session write ordering', () => {
  test('terminal flush queues behind an in-flight partial PUT', async () => {
    const controlled = createControlledApi()
    const sync = createCloudSessionSync(controlled.api)

    const partial = sync.upsert(createSession('same', 'partial', 1))
    sync.scheduleUpsert(createSession('same', 'terminal', 2))
    const flushed = sync.flush()

    expect(controlled.puts).toHaveLength(1)
    expect(controlled.puts[0].row.messages).toContain('partial')

    controlled.puts[0].pending.resolve({})
    await partial
    await nextTurn()

    expect(controlled.puts).toHaveLength(2)
    expect(controlled.puts[1].row.messages).toContain('terminal')
    controlled.puts[1].pending.resolve({})
    await flushed
  })

  test('same-session PUTs are serial and only the latest queued snapshot is sent', async () => {
    const controlled = createControlledApi()
    const sync = createCloudSessionSync(controlled.api)

    const first = sync.upsert(createSession('same', 'first', 1))
    const superseded = sync.upsert(createSession('same', 'superseded', 2))
    const latest = sync.upsert(createSession('same', 'terminal', 3))

    expect(controlled.puts).toHaveLength(1)
    controlled.puts[0].pending.resolve({})
    await first
    await nextTurn()

    expect(controlled.puts).toHaveLength(2)
    expect(controlled.puts[1].row.messages).not.toContain('superseded')
    expect(controlled.puts[1].row.messages).toContain('terminal')
    expect(controlled.maxSameSessionConcurrency).toBe(1)

    controlled.puts[1].pending.resolve({})
    await Promise.all([superseded, latest])
  })

  test('different sessions can upload in parallel', async () => {
    const controlled = createControlledApi()
    const sync = createCloudSessionSync(controlled.api)

    const first = sync.upsert(createSession('one', 'partial', 1))
    const second = sync.upsert(createSession('two', 'partial', 1))

    expect(controlled.puts).toHaveLength(2)
    controlled.puts[0].pending.resolve({})
    controlled.puts[1].pending.resolve({})
    await Promise.all([first, second])
  })

  test('delete waits for the active PUT, drops queued PUTs, and tombstones late upserts', async () => {
    const controlled = createControlledApi()
    const sync = createCloudSessionSync(controlled.api)

    const active = sync.upsert(createSession('gone', 'partial', 1))
    const queued = sync.upsert(createSession('gone', 'terminal', 2))
    const removed = sync.delete('gone')
    const late = sync.upsert(createSession('gone', 'late', 3))

    expect(controlled.puts).toHaveLength(1)
    expect(controlled.deletes).toHaveLength(0)

    controlled.puts[0].pending.resolve({})
    await active
    await nextTurn()

    expect(controlled.puts).toHaveLength(1)
    expect(controlled.deletes).toHaveLength(1)
    controlled.deletes[0].pending.resolve({})
    await Promise.all([queued, removed, late])

    sync.scheduleUpsert(createSession('gone', 'later-still', 4))
    await sync.flush()
    expect(controlled.puts).toHaveLength(1)
    expect(controlled.deletes).toHaveLength(1)
  })
})
