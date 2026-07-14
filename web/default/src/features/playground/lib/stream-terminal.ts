import type {
  ChatCompletionChunk,
  ChatCompletionUsage,
  StreamFinishReason,
} from '../types'

export interface StreamTerminalState {
  finishReason?: StreamFinishReason
  requestId?: string
  usage?: ChatCompletionUsage
  sawProtocolTerminal: boolean
}

export function createStreamTerminalState(): StreamTerminalState {
  return { sawProtocolTerminal: false }
}

export function consumeStreamChunk(
  state: StreamTerminalState,
  chunk: ChatCompletionChunk
): StreamTerminalState {
  const finishReason = chunk.choices?.find(
    (choice) => choice.finish_reason
  )?.finish_reason
  return {
    finishReason: finishReason ?? state.finishReason,
    requestId: chunk.id || state.requestId,
    usage: chunk.usage ?? state.usage,
    sawProtocolTerminal: state.sawProtocolTerminal || finishReason !== undefined,
  }
}

export function canCompleteClosedStream(
  state: StreamTerminalState,
  sawDone: boolean
): boolean {
  return sawDone || state.sawProtocolTerminal
}
