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
import type {
  ChatCompletionMessage,
  ChatCompletionRequest,
  ChatCompletionUsage,
  StreamFinishReason,
  StreamTerminationReason,
  ToolCall,
} from '../types'
import {
  AUTO_CONTINUATION_PROMPT,
  AUTO_TOOL_CONTINUATION_PROMPT,
  classifyAutoContinuation,
  type AutoContinuationReason,
} from './continuation'

export const DEFAULT_MAX_SEARCH_ROUNDS = 4
export const DEFAULT_MAX_AUTO_CONTINUATIONS = 2

export type ToolLoopPhase = 'requesting' | 'searching' | 'continuing'

export interface ToolLoopTurnResult {
  content: string
  toolCalls: ToolCall[]
  finishReason?: StreamFinishReason
  terminationReason: StreamTerminationReason
  requestId?: string
  usage?: ChatCompletionUsage
}

export interface ToolLoopResult extends ToolLoopTurnResult {
  searchRounds: number
  autoContinuations: number
}

export interface ToolLoopProgress {
  phase: ToolLoopPhase
  searchRounds: number
  autoContinuations: number
}

export interface ToolLoopRequestContext extends ToolLoopProgress {
  signal: AbortSignal
}

export interface ToolLoopContinuation {
  reason: AutoContinuationReason
  prompt: string
  separator: string
  searchRounds: number
  autoContinuations: number
}

export interface WebSearchResult {
  ok: boolean
  context?: string
  error?: string
}

export interface RunChatToolLoopOptions {
  payload: ChatCompletionRequest
  requestTurn: (
    payload: ChatCompletionRequest,
    context: ToolLoopRequestContext
  ) => Promise<ToolLoopTurnResult>
  searchWeb: (query: string, signal: AbortSignal) => Promise<WebSearchResult>
  signal?: AbortSignal
  onPhase?: (progress: ToolLoopProgress) => void
  onContinuation?: (continuation: ToolLoopContinuation) => void
  maxSearchRounds?: number
  maxAutoContinuations?: number
}

export class ToolLoopCancelledError extends Error {
  constructor() {
    super('Chat tool loop was cancelled')
    this.name = 'ToolLoopCancelledError'
  }
}

export function isToolLoopCancelledError(
  error: unknown
): error is ToolLoopCancelledError {
  return (
    error instanceof ToolLoopCancelledError ||
    (error instanceof Error && error.name === 'ToolLoopCancelledError')
  )
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ToolLoopCancelledError()
}

function waitForAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  throwIfAborted(signal)

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ToolLoopCancelledError())
    signal.addEventListener('abort', onAbort, { once: true })

    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) {
          reject(new ToolLoopCancelledError())
          return
        }
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) {
          reject(new ToolLoopCancelledError())
          return
        }
        reject(error)
      }
    )
  })
}

function parseSearchQuery(toolCall: ToolCall): string {
  try {
    const parsed = JSON.parse(toolCall.function.arguments || '{}') as {
      query?: unknown
    }
    return typeof parsed.query === 'string' ? parsed.query : ''
  } catch {
    return toolCall.function.arguments || ''
  }
}

async function resolveToolMessage(
  toolCall: ToolCall,
  searchWeb: RunChatToolLoopOptions['searchWeb'],
  signal: AbortSignal
): Promise<ChatCompletionMessage> {
  let content: string

  if (toolCall.function.name !== 'web_search') {
    content = `Tool "${toolCall.function.name}" is not available.`
  } else {
    try {
      const result = await waitForAbortable(
        searchWeb(parseSearchQuery(toolCall), signal),
        signal
      )
      content =
        result.ok && result.context
          ? result.context
          : `Search failed: ${result.error || 'no results found'}`
    } catch (error: unknown) {
      if (isToolLoopCancelledError(error) || signal.aborted) {
        throw new ToolLoopCancelledError()
      }
      content = 'Search failed: the search service is unavailable.'
    }
  }

  throwIfAborted(signal)
  return {
    role: 'tool',
    tool_call_id: toolCall.id,
    content,
  }
}

// Promise.all preserves the input array's order even if searches resolve in a
// different order. Building the messages here, then appending them together,
// prevents network timing from reordering tool_call_id/result pairs.
export async function resolveToolMessages(
  toolCalls: ToolCall[],
  searchWeb: RunChatToolLoopOptions['searchWeb'],
  signal: AbortSignal
): Promise<ChatCompletionMessage[]> {
  throwIfAborted(signal)
  const messages = await waitForAbortable(
    Promise.all(
      toolCalls.map((toolCall) =>
        resolveToolMessage(toolCall, searchWeb, signal)
      )
    ),
    signal
  )
  throwIfAborted(signal)
  return messages
}

function accumulateUsage(
  total: ChatCompletionUsage | undefined,
  next: ChatCompletionUsage | undefined
): ChatCompletionUsage | undefined {
  if (!next) return total
  return {
    prompt_tokens: (total?.prompt_tokens ?? 0) + next.prompt_tokens,
    completion_tokens: (total?.completion_tokens ?? 0) + next.completion_tokens,
    total_tokens: (total?.total_tokens ?? 0) + next.total_tokens,
  }
}

function continuationPrompt(reason: AutoContinuationReason): string {
  return reason === 'deferred'
    ? AUTO_TOOL_CONTINUATION_PROMPT
    : AUTO_CONTINUATION_PROMPT
}

/**
 * Execute the complete model -> web search -> model chain as one bounded run.
 * `requestTurn` is transport-agnostic: callers can adapt either SSE or JSON
 * responses to ToolLoopTurnResult while the orchestration and cancellation
 * semantics stay identical.
 */
export async function runChatToolLoop(
  options: RunChatToolLoopOptions
): Promise<ToolLoopResult> {
  const fallbackController = new AbortController()
  const signal = options.signal ?? fallbackController.signal
  const maxSearchRounds = Math.max(
    0,
    Math.trunc(options.maxSearchRounds ?? DEFAULT_MAX_SEARCH_ROUNDS)
  )
  const maxAutoContinuations = Math.max(
    0,
    Math.trunc(options.maxAutoContinuations ?? DEFAULT_MAX_AUTO_CONTINUATIONS)
  )
  const payload: ChatCompletionRequest = {
    ...options.payload,
    messages: [...options.payload.messages],
    tools: options.payload.tools ? [...options.payload.tools] : undefined,
  }

  let searchRounds = 0
  let autoContinuations = 0
  let usage: ChatCompletionUsage | undefined
  let visibleContent = ''
  let separatorBeforeNextContent = ''
  let nextPhase: ToolLoopPhase = 'requesting'

  for (;;) {
    throwIfAborted(signal)
    const progress: ToolLoopProgress = {
      phase: nextPhase,
      searchRounds,
      autoContinuations,
    }
    options.onPhase?.(progress)

    const turn = await waitForAbortable(
      options.requestTurn(payload, { ...progress, signal }),
      signal
    )
    throwIfAborted(signal)

    usage = accumulateUsage(usage, turn.usage)
    if (turn.content) {
      visibleContent +=
        visibleContent && separatorBeforeNextContent
          ? `${separatorBeforeNextContent}${turn.content}`
          : turn.content
    }
    separatorBeforeNextContent = ''

    if (turn.toolCalls.length > 0) {
      if (searchRounds >= maxSearchRounds) {
        return {
          ...turn,
          content: visibleContent,
          finishReason: 'length',
          terminationReason: 'length',
          usage,
          searchRounds,
          autoContinuations,
        }
      }

      payload.messages.push({
        role: 'assistant',
        content: turn.content || null,
        tool_calls: turn.toolCalls,
      })
      options.onPhase?.({
        phase: 'searching',
        searchRounds,
        autoContinuations,
      })
      const toolMessages = await resolveToolMessages(
        turn.toolCalls,
        options.searchWeb,
        signal
      )
      throwIfAborted(signal)
      payload.messages.push(...toolMessages)
      searchRounds += 1

      // The final permitted search has completed. Remove the tool declaration
      // before the next model request so it must answer from collected context.
      if (searchRounds >= maxSearchRounds) delete payload.tools
      if (turn.content) separatorBeforeNextContent = '\n\n'
      nextPhase = 'requesting'
      continue
    }

    const continuationReason = classifyAutoContinuation({
      model: payload.model,
      content: turn.content,
      finishReason: turn.finishReason,
      searchRounds,
    })
    if (continuationReason) {
      if (autoContinuations >= maxAutoContinuations) {
        return {
          ...turn,
          content: visibleContent,
          finishReason: 'length',
          terminationReason: 'length',
          usage,
          searchRounds,
          autoContinuations,
        }
      }

      const prompt = continuationPrompt(continuationReason)
      const separator = continuationReason === 'deferred' ? '\n\n' : ''
      autoContinuations += 1
      options.onContinuation?.({
        reason: continuationReason,
        prompt,
        separator,
        searchRounds,
        autoContinuations,
      })
      payload.messages.push(
        { role: 'assistant', content: turn.content || null },
        { role: 'user', content: prompt }
      )
      separatorBeforeNextContent = turn.content ? separator : ''
      nextPhase = 'continuing'
      continue
    }

    return {
      ...turn,
      content: visibleContent,
      usage,
      searchRounds,
      autoContinuations,
    }
  }
}
