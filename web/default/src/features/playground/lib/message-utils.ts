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
import { nanoid } from 'nanoid'
import { MESSAGE_ROLES, MESSAGE_STATUS, ERROR_MESSAGES } from '../constants'
import { putImage } from './image-store'
import { isGenerationActive } from './active-generations'
import type {
  Message,
  MessageVersion,
  ChatCompletionMessage,
  ContentPart,
  AttachedFile,
} from '../types'

/**
 * Create a new message version
 */
export function createMessageVersion(content: string): MessageVersion {
  return {
    id: nanoid(),
    content,
  }
}

/**
 * Get current version from message (always returns the first version)
 */
export function getCurrentVersion(message: Message): MessageVersion {
  return message.versions[0] || { id: 'default', content: '' }
}

/**
 * Update current version content in message
 */
export function updateCurrentVersionContent(
  message: Message,
  content: string
): Message {
  const currentVersion = getCurrentVersion(message)
  return {
    ...message,
    versions: [{ ...currentVersion, content }],
  }
}

/**
 * Create a user message, optionally carrying attached images (data URLs /
 * idbimg refs) — e.g. a generated picture the user is asking to edit — and/or
 * non-image documents (PDF / text), sent upstream as `file` content parts.
 */
export function createUserMessage(
  content: string,
  attachedImages?: string[],
  attachedFiles?: AttachedFile[]
): Message {
  return {
    key: nanoid(),
    from: MESSAGE_ROLES.USER,
    versions: [createMessageVersion(content)],
    ...(attachedImages && attachedImages.length ? { attachedImages } : {}),
    ...(attachedFiles && attachedFiles.length ? { attachedFiles } : {}),
  }
}

/**
 * Create a loading assistant message
 */
export function createLoadingAssistantMessage(): Message {
  return {
    key: nanoid(),
    from: MESSAGE_ROLES.ASSISTANT,
    versions: [createMessageVersion('')],
    reasoning: undefined,
    isReasoningComplete: false,
    isContentComplete: false,
    isReasoningStreaming: false,
    status: MESSAGE_STATUS.LOADING,
  }
}

/**
 * Build message content with optional images
 */
export function buildMessageContent(
  text: string,
  imageUrls: string[] = []
): string | ContentPart[] {
  const validImages = imageUrls.filter((url) => url.trim() !== '')

  if (validImages.length === 0) {
    return text
  }

  const parts: ContentPart[] = [
    {
      type: 'text',
      text: text || '',
    },
    ...validImages.map((url) => ({
      type: 'image_url' as const,
      image_url: { url: url.trim() },
    })),
  ]

  return parts
}

/**
 * Extract text content from message content
 */
export function getTextContent(content: string | ContentPart[]): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const textPart = content.find((part) => part.type === 'text')
    return textPart?.text || ''
  }

  return ''
}

/**
 * Format message for API request. When the message carries attached images
 * (e.g. a picture the user is editing), emit OpenAI-style multimodal content
 * (a text part + one image_url part per image) so image models like Nano Banana
 * receive the source image and can edit it. Plain messages stay as a string.
 * Images must already be resolved to data URLs (not idbimg:// refs) by the
 * caller, since this function is synchronous.
 */
export function formatMessageForAPI(message: Message): ChatCompletionMessage {
  const currentVersion = getCurrentVersion(message)
  // Strip any inline data-image / idbimg ref from the OUTGOING text: a prior
  // turn's multi-MB base64 (or an unresolvable idbimg:// ref) is noise to the
  // model and bloats the request. The picture being edited is sent cleanly via
  // image_url below; historical pictures collapse to a short placeholder.
  const rawText = currentVersion.content
  const text =
    typeof rawText === 'string' && hasAnyImageLink(rawText)
      ? stripImagesForApi(rawText)
      : rawText
  const images = (message.attachedImages ?? []).filter(
    (u) => typeof u === 'string' && u.startsWith('data:image/')
  )
  const files = (message.attachedFiles ?? []).filter(
    (f) => f && typeof f.dataUrl === 'string' && f.dataUrl.startsWith('data:')
  )
  if (images.length === 0 && files.length === 0) {
    return { role: message.from, content: text }
  }
  return {
    role: message.from,
    content: [
      { type: 'text', text },
      ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      ...files.map((f) => ({
        type: 'file' as const,
        file: { filename: f.name, file_data: f.dataUrl },
      })),
    ],
  }
}

/**
 * Check if message is valid for API request
 * Excludes loading/streaming assistant messages and empty content
 */
export function isValidMessage(message: Message): boolean {
  if (!message || !message.from || !message.versions.length) return false

  const content = message.versions[0]?.content
  if (content === undefined) return false

  // Exclude empty assistant messages (loading/streaming placeholders)
  if (message.from === 'assistant' && !content.trim()) return false

  return true
}

/**
 * Parse content to separate thinking from visible text
 * Handles both complete and incomplete <think> tags
 */
export function parseThinkTags(content: string): {
  visibleContent: string
  reasoning: string
  hasUnclosedTag: boolean
} {
  if (!content.includes('<think>')) {
    return { visibleContent: content, reasoning: '', hasUnclosedTag: false }
  }

  const visibleParts: string[] = []
  const reasoningParts: string[] = []
  let currentPos = 0
  let hasUnclosed = false

  while (true) {
    // Find next <think> tag
    const openPos = content.indexOf('<think>', currentPos)

    if (openPos === -1) {
      // No more think tags, add remaining content
      if (currentPos < content.length) {
        visibleParts.push(content.substring(currentPos))
      }
      break
    }

    // Add visible content before this tag
    if (openPos > currentPos) {
      visibleParts.push(content.substring(currentPos, openPos))
    }

    // Look for matching </think> tag
    const closePos = content.indexOf('</think>', openPos + 7)

    if (closePos === -1) {
      // Unclosed tag: rest is reasoning buffer
      reasoningParts.push(content.substring(openPos + 7))
      hasUnclosed = true
      break
    }

    // Extract reasoning content between tags
    reasoningParts.push(content.substring(openPos + 7, closePos))
    currentPos = closePos + 8
  }

  return {
    visibleContent: visibleParts.join('').trim(),
    reasoning: reasoningParts.join('\n\n').trim(),
    hasUnclosedTag: hasUnclosed,
  }
}

/**
 * Update the last assistant message with an error
 * @param messages - Current messages array
 * @param errorMessage - Error message to display
 * @returns Updated messages array
 */
export function updateAssistantMessageWithError(
  messages: Message[],
  errorMessage: string,
  errorCode?: string
): Message[] {
  return updateLastAssistantMessage(messages, (message) => {
    const updatedMessage = updateCurrentVersionContent(
      message,
      `${ERROR_MESSAGES.API_REQUEST_ERROR}: ${errorMessage}`
    )
    return {
      ...updatedMessage,
      status: MESSAGE_STATUS.ERROR,
      isReasoningStreaming: false,
      errorCode: errorCode || null,
    }
  })
}

/**
 * Helper function to update the last assistant message
 * @param messages - Current messages array
 * @param updater - Function to update the message
 * @returns Updated messages array or original if no assistant message found
 */
export function updateLastAssistantMessage(
  messages: Message[],
  updater: (message: Message) => Message
): Message[] {
  if (messages.length === 0) return messages
  const last = messages[messages.length - 1]
  if (!last || last.from !== MESSAGE_ROLES.ASSISTANT) return messages

  const updated = [...messages]
  updated[updated.length - 1] = updater(last)
  return updated
}

/**
 * Process content chunk during streaming
 * Separates <think> reasoning from visible content in real-time
 * Note: versions[0].content keeps the full raw content (with tags) during streaming
 */
export function processStreamingContent(
  message: Message,
  contentChunk?: string
): Message {
  const currentVersion = getCurrentVersion(message)
  const fullContent = contentChunk
    ? currentVersion.content + contentChunk
    : currentVersion.content

  const { reasoning, hasUnclosedTag } = parseThinkTags(fullContent)

  // Preserve existing reasoning if no think tags found (e.g., from API reasoning_content)
  const finalReasoning = reasoning
    ? { content: reasoning, duration: 0 }
    : message.reasoning

  return {
    ...updateCurrentVersionContent(message, fullContent),
    reasoning: finalReasoning,
    isReasoningStreaming: hasUnclosedTag,
  }
}

/**
 * Finalize message after streaming completes
 * Cleans content and consolidates reasoning from all sources
 */
export function finalizeMessage(
  message: Message,
  apiReasoningContent?: string
): Message {
  const currentVersion = getCurrentVersion(message)
  const { visibleContent, reasoning } = parseThinkTags(currentVersion.content)

  // Priority:
  // 1. API reasoning_content passed as parameter (non-streaming response)
  // 2. Existing message.reasoning (from streaming reasoning_content)
  // 3. Extracted think tags from content
  const finalReasoning =
    apiReasoningContent || message.reasoning?.content || reasoning || ''

  return {
    ...updateCurrentVersionContent(message, visibleContent),
    reasoning: finalReasoning
      ? { content: finalReasoning, duration: message.reasoning?.duration || 0 }
      : undefined,
    isReasoningStreaming: false,
  }
}

/**
 * Update a specific message by its stable key (not "the last assistant
 * message"). Detached image generation targets a fixed message so its late
 * result lands on the right bubble even after other turns were added.
 */
export function updateMessageByKey(
  messages: Message[],
  key: string,
  updater: (message: Message) => Message
): Message[] {
  let changed = false
  const next = messages.map((m) => {
    if (m.key !== key) return m
    changed = true
    return updater(m)
  })
  return changed ? next : messages
}

/**
 * Sanitize messages loaded from storage
 * Converts stuck loading/streaming messages to stable state
 */
export function sanitizeMessagesOnLoad(messages: Message[]): Message[] {
  let targetIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (
      m?.from === MESSAGE_ROLES.ASSISTANT &&
      (m?.status === MESSAGE_STATUS.LOADING ||
        m?.status === MESSAGE_STATUS.STREAMING)
    ) {
      // A message whose image generation is still running detached (user
      // navigated away and back) is NOT interrupted — leave it as-is so the
      // manager can finish it and the reconnect effect can re-render progress.
      if (m.key && isGenerationActive(m.key)) continue
      targetIndex = i
      break
    }
  }

  if (targetIndex === -1) return messages

  const finalized = finalizeMessage(messages[targetIndex])
  const hasContent = finalized.versions?.[0]?.content?.trim()
  const hasReasoning = finalized.reasoning?.content?.trim()

  const sanitized: Message =
    hasContent || hasReasoning
      ? {
          ...finalized,
          status: MESSAGE_STATUS.COMPLETE,
          isReasoningStreaming: false,
        }
      : {
          ...updateCurrentVersionContent(
            finalized,
            `${ERROR_MESSAGES.API_REQUEST_ERROR}: ${ERROR_MESSAGES.INTERRUPTED}`
          ),
          status: MESSAGE_STATUS.ERROR,
          isReasoningStreaming: false,
        }

  const result = [...messages]
  result[targetIndex] = sanitized
  return result
}

// Generated images come back inline as huge base64 data URIs
// (![alt](data:image/png;base64,....)). Showing those verbatim when the user
// copies or edits a message dumps a wall of code, so for those flows we replace
// each data-image link with a short, human-readable placeholder. The rendered
// chat bubble still shows the real picture (see ai-elements/response.tsx); this
// only affects the text the user copies / edits.
const DATA_IMAGE_LINK =
  /!\[[^\]]*\]\(data:image\/[a-zA-Z0-9.+-]+;base64,[^\s)]+\)/g

export function hasDataImage(content: string): boolean {
  DATA_IMAGE_LINK.lastIndex = 0
  return DATA_IMAGE_LINK.test(content)
}

export function stripDataImagesForText(content: string): string {
  DATA_IMAGE_LINK.lastIndex = 0
  return content.replace(DATA_IMAGE_LINK, '[图片]').trim()
}

// Any image markdown link the chat may hold — inline base64 OR a persisted
// `idbimg://<id>` reference. Used to scrub a prior turn's image out of the text
// we send upstream (the picture being edited is sent separately via image_url;
// a stale idbimg ref would be meaningless to the model).
const ANY_IMAGE_LINK =
  /!\[[^\]]*\]\((?:data:image\/[a-zA-Z0-9.+-]+;base64,|idbimg:\/\/)[^\s)]+\)/g

export function hasAnyImageLink(content: string): boolean {
  ANY_IMAGE_LINK.lastIndex = 0
  return ANY_IMAGE_LINK.test(content)
}

export function stripImagesForApi(content: string): string {
  ANY_IMAGE_LINK.lastIndex = 0
  return content.replace(ANY_IMAGE_LINK, '[图片]').trim()
}

// Capturing variant: alt + data: url separately, to rewrite the reference.
const DATA_IMAGE_CAPTURE =
  /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[^\s)]+)\)/g

// Move base64 data-images into the browser's LOCAL IndexedDB (NOT the cloud —
// same spirit as chat history living in localStorage, just a bigger local store
// for the heavy image bytes) and replace them in the content with a lightweight
// `idbimg://<id>` reference. This keeps chat history persistable to localStorage
// without blowing the quota, AND the picture survives a refresh (the bubble
// resolves the ref back via ai-elements/response.tsx). Falls back to the
// original data URL when IndexedDB is unavailable (putImage returns it).
export async function offloadDataImagesToIdb(content: string): Promise<string> {
  if (typeof content !== 'string' || !hasDataImage(content)) return content
  const matches = [...content.matchAll(DATA_IMAGE_CAPTURE)]
  let out = content
  for (const m of matches) {
    const [full, alt, url] = m
    const ref = await putImage(url)
    out = out.replace(full, `![${alt}](${ref})`)
  }
  return out
}

// Apply offloadDataImagesToIdb across all messages (used before persisting).
// Also offloads a user message's attachedImages (reference pictures) the same
// way: otherwise their raw base64 is stripped by stripDataImagesFromMessages on
// save and the attachment vanishes from history. As idbimg:// refs they persist
// AND stay renderable in the bubble.
export async function offloadMessagesImagesToIdb<T>(messages: T): Promise<T> {
  if (!Array.isArray(messages)) return messages
  const result = await Promise.all(
    messages.map(async (msg) => {
      const m = msg as {
        versions?: Array<{ content?: string }>
        attachedImages?: string[]
      }
      if (!m?.versions?.length) return msg
      let changed = false
      const versions = await Promise.all(
        m.versions.map(async (v) => {
          if (typeof v?.content === 'string' && hasDataImage(v.content)) {
            const next = await offloadDataImagesToIdb(v.content)
            if (next !== v.content) {
              changed = true
              return { ...v, content: next }
            }
          }
          return v
        })
      )
      let attachedImages = m.attachedImages
      if (attachedImages?.some((u) => u.startsWith('data:image/'))) {
        attachedImages = await Promise.all(
          attachedImages.map((u) =>
            u.startsWith('data:image/') ? putImage(u) : Promise.resolve(u)
          )
        )
        changed = true
      }
      return changed ? { ...m, versions, attachedImages } : msg
    })
  )
  return result as T
}

// A generated image inside assistant markdown: inline base64 (live) or an
// idbimg:// ref (restored history). Mirrors response.tsx's DATA_IMAGE_MD.
const GENERATED_IMAGE_MD =
  /!\[[^\]]*\]\(((?:data:image\/[a-zA-Z0-9.+-]+;base64,|idbimg:\/\/)[^\s)]+)\)/g

/**
 * The newest generated image in this conversation (scanning backwards over
 * assistant messages; last image of that message wins). Used for chat-native
 * multi-turn editing: a follow-up like "把猫猫改成暹罗猫" with nothing attached
 * refers to the picture above, not a fresh canvas.
 */
export function findLatestGeneratedImage(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.from !== MESSAGE_ROLES.ASSISTANT) continue
    const content = getCurrentVersion(m).content
    if (typeof content !== 'string' || !content) continue
    GENERATED_IMAGE_MD.lastIndex = 0
    let match: RegExpExecArray | null
    let last: string | null = null
    while ((match = GENERATED_IMAGE_MD.exec(content)) !== null) {
      last = match[1]
    }
    if (last) return last
  }
  return null
}

// localStorage caps at ~5MB; a single generated image is 2MB+ of base64, so
// persisting raw image messages overflows the quota — the write fails and on
// the next load the history is truncated/empty, surfacing as "Generation was
// interrupted". We therefore strip base64 data-images down to a marker BEFORE
// persisting. The live in-memory session still shows the real picture; only the
// saved history drops the heavy bytes (the image was a one-shot generation).
export function stripDataImagesFromMessages<T>(messages: T): T {
  if (!Array.isArray(messages)) return messages
  return messages.map((msg) => {
    const m = msg as {
      versions?: Array<{ content?: string }>
      attachedFiles?: Array<{ name: string; dataUrl: string }>
    }
    if (!m?.versions?.length) return msg
    let changed = false
    const versions = m.versions.map((v) => {
      if (typeof v?.content === 'string' && hasDataImage(v.content)) {
        changed = true
        return { ...v, content: stripDataImagesForText(v.content) }
      }
      return v
    })
    // Attached document bytes (PDF/text base64) are heavy one-shot inputs — like
    // generated images, drop their data before persisting so localStorage's ~5MB
    // quota isn't blown (which would truncate/erase chat history). Keep the
    // filename so the chip still shows what was sent; the live in-memory session
    // keeps the real bytes for the request.
    let attachedFiles = m.attachedFiles
    if (attachedFiles?.length && attachedFiles.some((f) => f.dataUrl)) {
      changed = true
      attachedFiles = attachedFiles.map((f) => ({ ...f, dataUrl: '' }))
    }
    // Attached reference images (image-to-image inputs) are raw multi-MB data
    // URLs on the user message. Drop them too (tiny idbimg:// refs pass) —
    // they blew the cloud-sync 1MB row limit with a 400 the first time an
    // edits conversation synced (2026-07-03).
    const mi = msg as { attachedImages?: string[] }
    let attachedImages = mi.attachedImages
    if (attachedImages?.length && attachedImages.some((u) => u.startsWith('data:'))) {
      changed = true
      attachedImages = attachedImages.filter((u) => !u.startsWith('data:'))
    }
    return changed
      ? {
          ...m,
          versions,
          ...(attachedFiles ? { attachedFiles } : {}),
          ...(attachedImages ? { attachedImages } : {}),
        }
      : msg
  }) as T
}
