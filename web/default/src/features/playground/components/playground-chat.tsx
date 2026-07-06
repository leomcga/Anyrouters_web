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
import { useEffect, useMemo, useState } from 'react'
import { FileText, Globe, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Branch,
  BranchMessages,
  BranchNext,
  BranchPage,
  BranchPrevious,
  BranchSelector,
} from '@/components/ai-elements/branch'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Loader } from '@/components/ai-elements/loader'
import { Message, MessageContent } from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import {
  GeneratedImage,
  ImagePendingContext,
  Response,
} from '@/components/ai-elements/response'
import { Shimmer } from '@/components/ai-elements/shimmer'
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/sources'
import { MESSAGE_ROLES } from '../constants'
import {
  extractRunnableCode,
  isFileProducingCode,
  stripRunnableCode,
} from '../lib/code-extract'
import { isImageGenModel } from '../lib/image-models'
import { getMessageContentStyles } from '../lib/message-styles'
import {
  parseThinkTags,
  hasDataImage,
  stripDataImagesForText,
} from '../lib/message-utils'
import { LONG_CONVERSATION_HINT_THRESHOLD } from '../lib/sessions'
import type { Message as MessageType } from '../types'
import { CodeRunPanel } from './code-run-panel'
import { MessageActions } from './message-actions'
import { MessageError } from './message-error'

// Whether to hide the runnable python block from the bubble. When finished, we
// move a completed block into the collapsible run panel. While still streaming,
// once a python fence has opened we also hide it so a long script doesn't flood
// the chat line-by-line (it reappears collapsed in the run panel on completion).
function shouldStripCode(content: string, status?: string): boolean {
  const streaming = status === 'streaming' || status === 'loading'
  if (!streaming) return !!extractRunnableCode(content)
  // mid-stream: hide as soon as a ```python / ```py fence has started
  return /```(?:python|py)\b/i.test(content)
}

// Reference pictures / documents the user attached to a message. Rendered in
// the bubble so the sent attachments stay visible in history (traceability) —
// without this they were sent to the model but never shown, so users thought
// their upload "disappeared". Images may be data: URLs (fresh) or idbimg:// refs
// (restored); GeneratedImage resolves both.
function MessageAttachments({
  images,
  files,
}: {
  images?: string[]
  files?: { name: string }[]
}) {
  const hasImages = !!images?.length
  const hasFiles = !!files?.length
  if (!hasImages && !hasFiles) return null
  return (
    <div className='mb-2 flex flex-wrap justify-end gap-2'>
      {images?.map((src, i) => (
        <div
          key={`att-img-${i}`}
          className='overflow-hidden rounded-lg border'
          style={{ maxWidth: 140 }}
        >
          <GeneratedImage src={src} alt='attachment' />
        </div>
      ))}
      {files?.map((f, i) => (
        <div
          key={`att-file-${i}`}
          className='bg-muted flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs'
        >
          <FileText className='size-3.5 shrink-0' />
          <span className='max-w-[160px] truncate'>{f.name}</span>
        </div>
      ))}
    </div>
  )
}

interface PlaygroundChatProps {
  messages: MessageType[]
  onCopyMessage?: (message: MessageType) => void
  onRegenerateMessage?: (message: MessageType) => void
  onEditMessage?: (message: MessageType) => void
  onDeleteMessage?: (message: MessageType) => void
  isGenerating?: boolean
  editingKey?: string | null
  onSaveEdit?: (newContent: string) => void
  onCancelEdit?: (open: boolean) => void
  onSaveEditAndSubmit?: (newContent: string) => void
  // Current model, so a live image-generation turn can collapse its "thinking"
  // trace from the very start (before the image lands) — a wall of reasoning
  // text mid-generation just confuses non-technical users.
  currentModel?: string
}

export function PlaygroundChat({
  messages,
  onCopyMessage,
  onRegenerateMessage,
  onEditMessage,
  onDeleteMessage,
  isGenerating = false,
  editingKey,
  onSaveEdit,
  onCancelEdit,
  onSaveEditAndSubmit,
  currentModel,
}: PlaygroundChatProps) {
  const currentIsImageModel = currentModel
    ? isImageGenModel(currentModel)
    : false
  const { t } = useTranslation()
  const [editText, setEditText] = useState('')
  const [originalText, setOriginalText] = useState('')

  useEffect(() => {
    if (!editingKey) return
    const message = messages.find((m) => m.key === editingKey)
    const raw = message?.versions?.[0]?.content || ''
    // Don't dump a giant base64 data URI into the edit box; show a placeholder
    // for generated images so the user edits readable text.
    const content = hasDataImage(raw) ? stripDataImagesForText(raw) : raw
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditText(content)

    setOriginalText(content)
  }, [editingKey, messages])

  const isEditing = (key: string) => editingKey === key
  const isEmpty = useMemo(() => !editText.trim(), [editText])
  const isChanged = useMemo(
    () => editText !== originalText,
    [editText, originalText]
  )
  return (
    <Conversation>
      {/* Remove outer padding; apply padding to inner centered container to align with input */}
      <ConversationContent className='p-0'>
        <div className='mx-auto w-full max-w-4xl px-4 py-4'>
          {messages.map((message, messageIndex) => {
            const { versions = [] } = message
            const isLastAssistantMessage =
              messageIndex === messages.length - 1 &&
              message.from === MESSAGE_ROLES.ASSISTANT
            return (
              <Branch defaultBranch={0} key={message.key}>
                <BranchMessages>
                  {versions.map((version, versionIndex) => (
                    <Message
                      className='group flex-row-reverse'
                      from={message.from}
                      key={`${message.key}-${version.id}-${versionIndex}`}
                    >
                      {/* User messages (text + attachments) hug the RIGHT like a
                          messenger; assistant fills the row on the LEFT. Without
                          items-end the user bubble was left-aligned while its
                          attachments sat right — the mismatch users noticed. */}
                      <div
                        className={cn(
                          'w-full min-w-0 flex-1 basis-full py-1',
                          message.from === MESSAGE_ROLES.USER &&
                            'flex flex-col items-end'
                        )}
                      >
                        {isEditing(message.key) ? (
                          <div className='w-full space-y-2'>
                            <Textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              className='font-mono text-sm'
                              rows={8}
                            />
                            <div className='flex gap-2'>
                              {/* Save & Submit only makes sense for user messages */}
                              {message.from === MESSAGE_ROLES.USER && (
                                <Button
                                  size='sm'
                                  onClick={() =>
                                    onSaveEditAndSubmit?.(editText)
                                  }
                                  disabled={isEmpty || !isChanged}
                                >
                                  Save & Submit
                                </Button>
                              )}
                              <Button
                                size='sm'
                                onClick={() => onSaveEdit?.(editText)}
                                disabled={isEmpty || !isChanged}
                              >
                                Save
                              </Button>
                              <Button
                                size='sm'
                                variant='outline'
                                onClick={() => onCancelEdit?.(false)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {(() => {
                              const isAssistant =
                                message.from === MESSAGE_ROLES.ASSISTANT
                              const hasSources = !!message.sources?.length
                              const showReasoning =
                                isAssistant && !!message.reasoning?.content
                              // Image-generation replies (Nano Banana etc.) also
                              // stream a "thinking" trace. The user wants the
                              // picture, not a wall of thoughts — so once the
                              // image has landed, collapse the reasoning by
                              // default (still expandable). Detect by a generated
                              // image in the content.
                              const hasGeneratedImage =
                                /(?:data:image\/|idbimg:\/\/|!video\[)/.test(
                                  version.content || ''
                                )
                              // Collapse the thinking trace for image turns from
                              // the START: after the image lands (hasGeneratedImage)
                              // and also WHILE it's still generating on an image
                              // model — so "thinking…" text never fills the bubble.
                              const isThisGenerating =
                                message.status === 'streaming' ||
                                message.status === 'loading'
                              const collapseReasoning =
                                hasGeneratedImage ||
                                (currentIsImageModel && isThisGenerating)
                              const showLoader =
                                isAssistant &&
                                !message.isSearching &&
                                !message.isReasoningStreaming &&
                                (message.status === 'loading' ||
                                  (message.status === 'streaming' &&
                                    !version.content))
                              const showMessageContent =
                                (message.from === MESSAGE_ROLES.USER ||
                                  !message.isReasoningStreaming) &&
                                !!version.content

                              // Extract visible content (remove <think> tags for assistant messages)
                              const displayContent = isAssistant
                                ? parseThinkTags(version.content).visibleContent
                                : version.content

                              const actions = (
                                <MessageActions
                                  message={message}
                                  onCopy={onCopyMessage}
                                  onRegenerate={onRegenerateMessage}
                                  onEdit={onEditMessage}
                                  onDelete={onDeleteMessage}
                                  isGenerating={isGenerating}
                                  alwaysVisible={isLastAssistantMessage}
                                  className='mt-1'
                                />
                              )

                              return (
                                <>
                                  {/* Sources */}
                                  {hasSources && (
                                    <Sources>
                                      <SourcesTrigger
                                        count={message.sources!.length}
                                      />
                                      <SourcesContent>
                                        {message.sources!.map(
                                          (source, sourceIndex) => (
                                            <Source
                                              href={source.href}
                                              key={`${message.key}-source-${sourceIndex}`}
                                              title={source.title}
                                            />
                                          )
                                        )}
                                      </SourcesContent>
                                    </Sources>
                                  )}

                                  {/* Reasoning */}
                                  {showReasoning && (
                                    <Reasoning
                                      defaultOpen={!collapseReasoning}
                                      isStreaming={message.isReasoningStreaming}
                                    >
                                      <ReasoningTrigger />
                                      <ReasoningContent>
                                        {message.reasoning!.content}
                                      </ReasoningContent>
                                    </Reasoning>
                                  )}

                                  {/* Web search indicator */}
                                  {isAssistant && message.isSearching && (
                                    <div className='flex items-center gap-2 py-2'>
                                      <Globe className='text-muted-foreground size-4 animate-pulse' />
                                      <Shimmer className='text-sm' duration={1}>
                                        {t('Searching the web…')}
                                      </Shimmer>
                                    </div>
                                  )}

                                  {/* Loader */}
                                  {showLoader && (
                                    <div className='flex items-center gap-2 py-2'>
                                      <Loader />
                                      <Shimmer className='text-sm' duration={1}>
                                        {t('Generating…')}
                                      </Shimmer>
                                    </div>
                                  )}

                                  {/* Attachments the user sent (reference
                                      images / documents) — kept visible in
                                      history so uploads don't seem to vanish. */}
                                  {versionIndex === 0 && (
                                    <MessageAttachments
                                      images={message.attachedImages}
                                      files={message.attachedFiles}
                                    />
                                  )}

                                  {/* Error or Content */}
                                  {message.status === 'error' ? (
                                    <>
                                      <MessageError
                                        message={message}
                                        className='mb-2'
                                      />
                                      {actions}
                                    </>
                                  ) : (
                                    showMessageContent && (
                                      <>
                                        <MessageContent
                                          variant='flat'
                                          className={cn(
                                            getMessageContentStyles()
                                          )}
                                        >
                                          {/* While this message is still
                                              generating, in-bubble images are
                                              partial low-fidelity frames: blur
                                              them + withhold download until the
                                              full-quality image lands. */}
                                          <ImagePendingContext.Provider
                                            value={
                                              isAssistant &&
                                              (message.status === 'streaming' ||
                                                message.status === 'loading')
                                            }
                                          >
                                            <Response>
                                              {isAssistant &&
                                              shouldStripCode(
                                                displayContent,
                                                message.status
                                              )
                                                ? stripRunnableCode(
                                                    displayContent
                                                  )
                                                : displayContent}
                                            </Response>
                                          </ImagePendingContext.Provider>
                                        </MessageContent>
                                        {/* Image stream was cut before the
                                            full-quality frame arrived: what's
                                            shown is a low-res partial preview.
                                            Say so — silently presenting it as
                                            the result reads as bad model
                                            quality. */}
                                        {isAssistant &&
                                          message.imageDegraded &&
                                          message.status !== 'streaming' &&
                                          message.status !== 'loading' && (
                                            <div className='mt-2 flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400'>
                                              <TriangleAlert className='size-4 shrink-0' />
                                              {t(
                                                'The full-quality image did not arrive — this is a low-res preview. Tap regenerate below to get the finished image.'
                                              )}
                                            </div>
                                          )}
                                        {/* While streaming, if we've hidden a
                                            python block, show a compact writing
                                            indicator instead of flooding code. */}
                                        {isAssistant &&
                                          (message.status === 'streaming' ||
                                            message.status === 'loading') &&
                                          /```(?:python|py)\b/i.test(
                                            displayContent
                                          ) && (
                                            <div className='text-muted-foreground mt-2 flex items-center gap-2 text-sm'>
                                              <Loader className='size-4' />
                                              {t('Writing script…')}
                                            </div>
                                          )}
                                        {/* Code execution: offer to run any
                                            python block in a completed reply. */}
                                        {isAssistant &&
                                          message.status !== 'streaming' &&
                                          message.status !== 'loading' &&
                                          (() => {
                                            const runnable =
                                              extractRunnableCode(
                                                displayContent
                                              )
                                            return runnable ? (
                                              <CodeRunPanel
                                                code={runnable}
                                                autoRun={isFileProducingCode(
                                                  runnable
                                                )}
                                              />
                                            ) : null
                                          })()}
                                        {actions}
                                      </>
                                    )
                                  )}
                                </>
                              )
                            })()}
                          </>
                        )}
                      </div>
                    </Message>
                  ))}
                </BranchMessages>

                {/* Branch selector for multiple versions */}
                {versions.length > 1 && (
                  <BranchSelector className='px-0' from={message.from}>
                    <BranchPrevious />
                    <BranchPage />
                    <BranchNext />
                  </BranchSelector>
                )}
              </Branch>
            )
          })}
          {messages.length >= LONG_CONVERSATION_HINT_THRESHOLD && (
            <div className='text-muted-foreground bg-muted/50 mx-auto my-3 max-w-md rounded-md px-3 py-2 text-center text-xs'>
              {t(
                'This conversation is getting long. Starting a new one keeps things fast and responsive.'
              )}
            </div>
          )}
        </div>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
