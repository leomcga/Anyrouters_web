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
import { Copy, Check, RefreshCw, Edit, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MESSAGE_ACTION_LABELS } from '../constants'
import { useMessageActionGuard } from '../hooks/use-message-action-guard'
import { hasDataImage, stripDataImagesForText } from '../lib/message-utils'
import type { Message } from '../types'
import { MessageActionButton } from './message-action-button'

interface MessageActionsProps {
  message: Message
  onCopy?: (message: Message) => void
  onRegenerate?: (message: Message) => void
  onEdit?: (message: Message) => void
  onDelete?: (message: Message) => void
  isGenerating?: boolean
  alwaysVisible?: boolean
  className?: string
}

export function MessageActions({
  message,
  onCopy,
  onRegenerate,
  onEdit,
  onDelete,
  isGenerating = false,
  alwaysVisible = false,
  className = '',
}: MessageActionsProps) {
  const { copiedText, copyToClipboard } = useCopyToClipboard()
  const { guardAction } = useMessageActionGuard(isGenerating)

  const isAssistant = message.from === 'assistant'
  const hasContent = message.versions.some((v) => v.content)
  const isLoading =
    message.status === 'loading' || message.status === 'streaming'
  const content = message.versions[0]?.content || ''
  const isCopied = copiedText === content
  // An image-only message: content is just a generated picture (data/idbimg
  // image link, possibly collapsed to a "[图片]" placeholder) with no real text.
  // For these, editing the *text* is meaningless and collides with the picture's
  // own "edit image" button, so we hide the text Edit action. Picture editing
  // lives on the image itself (the wand button in response.tsx).
  const isImageOnly =
    isAssistant &&
    (hasDataImage(content) ||
      /^\s*(!\[[^\]]*\]\(idbimg:\/\/[^\s)]+\)|\[图片\])\s*$/.test(content))

  const handleCopy = async () => {
    if (!content) {
      toast.warning(MESSAGE_ACTION_LABELS.NO_CONTENT)
      return
    }
    // For a generated image, copy the actual picture to the clipboard (so it can
    // be pasted into other apps) rather than the giant base64 text or a bare
    // "[图片]" placeholder. Falls back to placeholder text if the image clipboard
    // API is unavailable.
    const dataUrl = content.match(
      /data:image\/[a-zA-Z0-9.+-]+;base64,[^\s)]+/
    )?.[0]
    if (dataUrl) {
      try {
        const blob = await (await fetch(dataUrl)).blob()
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob }),
        ])
        toast.success('图片已复制')
        onCopy?.(message)
        return
      } catch {
        // image clipboard not supported — fall through to text placeholder
      }
    }
    const textToCopy = hasDataImage(content)
      ? stripDataImagesForText(content)
      : content
    copyToClipboard(textToCopy)
    onCopy?.(message)
  }

  const handleRegenerate = guardAction(() => onRegenerate?.(message))
  const handleEdit = guardAction(() => onEdit?.(message))
  const handleDelete = guardAction(() => onDelete?.(message))

  const visibilityClass = alwaysVisible
    ? 'opacity-100'
    : 'opacity-0 group-hover:opacity-100 max-md:opacity-100'

  return (
    <TooltipProvider delay={300}>
      <div
        className={`flex items-center gap-0.5 transition-opacity ${visibilityClass} ${className}`}
      >
        {/* Copy */}
        {hasContent && (
          <MessageActionButton
            icon={isCopied ? Check : Copy}
            label={
              isCopied
                ? MESSAGE_ACTION_LABELS.COPIED
                : MESSAGE_ACTION_LABELS.COPY
            }
            onClick={handleCopy}
            className={isCopied ? 'text-green-600' : ''}
          />
        )}

        {/* Regenerate - only for assistant messages */}
        {isAssistant && !isLoading && onRegenerate && (
          <MessageActionButton
            icon={RefreshCw}
            label={MESSAGE_ACTION_LABELS.REGENERATE}
            onClick={handleRegenerate}
            disabled={isGenerating}
          />
        )}

        {/* Edit (text). Hidden for image-only messages — editing a picture's
            text is meaningless; use the image's own edit button instead. */}
        {hasContent && !isImageOnly && onEdit && (
          <MessageActionButton
            icon={Edit}
            label={MESSAGE_ACTION_LABELS.EDIT}
            onClick={handleEdit}
            disabled={isGenerating}
          />
        )}

        {/* Delete */}
        {onDelete && (
          <MessageActionButton
            icon={Trash2}
            label={MESSAGE_ACTION_LABELS.DELETE}
            onClick={handleDelete}
            disabled={isGenerating}
            variant='destructive'
          />
        )}
      </div>
    </TooltipProvider>
  )
}
