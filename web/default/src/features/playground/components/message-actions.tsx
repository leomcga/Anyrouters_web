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
import { useState } from 'react'
import {
  Copy,
  Check,
  RefreshCw,
  Edit,
  Trash2,
  Download,
  FileText,
  FileType,
  FileDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { MESSAGE_ACTION_LABELS } from '../constants'
import { useMessageActionGuard } from '../hooks/use-message-action-guard'
import { hasDataImage, stripDataImagesForText } from '../lib/message-utils'
import { getImage, isIdbImageRef } from '../lib/image-store'
import { exportMessage, safeFileStem } from '../lib/file-export'
import type { Message } from '../types'
import { MessageActionButton } from './message-action-button'

// Derive a clean, short filename stem from a message's markdown. Old behavior
// used the whole answer body with markdown chars stripped, which produced ugly
// filenames like "这是个很有意思的题目。毛选里最能落地的其实是那套方法论——…docx".
// Prefer, in order: the first markdown heading, a bolded lead-in, or the first
// short line/sentence — then cap length. Falls back to "message".
function deriveExportStem(markdown: string): string {
  const lines = markdown
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  // 1) first ATX heading (# .. ######)
  const heading = lines.find((l) => /^#{1,6}\s+/.test(l))
  if (heading) return safeFileStem(heading.replace(/^#{1,6}\s+/, ''), 'message')
  // 2) a leading **bold** title on the first non-empty line
  const bold = lines[0]?.match(/^\*\*(.+?)\*\*/)?.[1]
  if (bold) return safeFileStem(bold, 'message')
  // 3) first line, trimmed to the first sentence-ish boundary
  const first = (lines[0] || '')
    .replace(/[#*`>|\-]/g, ' ')
    .split(/[。.!?！？\n]/)[0]
    .trim()
  return safeFileStem(first, 'message')
}

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
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard()
  const { guardAction } = useMessageActionGuard(isGenerating)
  const [exporting, setExporting] = useState(false)

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
    // be pasted into other apps / WeChat) rather than the giant base64 text or a
    // bare "[图片]" placeholder. The image may be inline base64 OR a persisted
    // `idbimg://<id>` reference (history / after offload) — resolve the ref from
    // IndexedDB first. Falls back to placeholder text if the image clipboard API
    // is unavailable.
    let dataUrl = content.match(
      /data:image\/[a-zA-Z0-9.+-]+;base64,[^\s)]+/
    )?.[0]
    if (!dataUrl) {
      const idbRef = content.match(/idbimg:\/\/[^\s)]+/)?.[0]
      if (idbRef && isIdbImageRef(idbRef)) {
        dataUrl = (await getImage(idbRef)) ?? undefined
      }
    }
    if (dataUrl) {
      try {
        const srcUrl = dataUrl
        // Clipboard images MUST be PNG: Chromium rejects jpeg/webp
        // ClipboardItems outright. gpt-image-2 emits PNG (fine), but Gemini
        // (Nano Banana) emits JPEG — which made this silently fall through to
        // the "[图片]" text fallback (real complaint, 2026-07-03). Non-PNG is
        // transcoded via canvas; the ClipboardItem takes the PROMISE so the
        // write stays inside the user-gesture window (Safari requirement).
        const pngBlob = (async () => {
          const blob = await (await fetch(srcUrl)).blob()
          if (blob.type === 'image/png') return blob
          const img = new Image()
          await new Promise((ok, err) => {
            img.onload = ok
            img.onerror = err
            img.src = srcUrl
          })
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          canvas.getContext('2d')!.drawImage(img, 0, 0)
          const out = await new Promise<Blob | null>((res) =>
            canvas.toBlob(res, 'image/png')
          )
          if (!out) throw new Error('png transcode failed')
          return out
        })()
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlob }),
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

  // Export the whole assistant message to a document. `content` is the raw
  // markdown the model produced, so md/docx/pdf all start from the same source.
  // Images (base64/idbimg) are stripped to a placeholder so we don't dump giant
  // blobs into the document.
  const handleExport = async (format: 'md' | 'docx' | 'pdf') => {
    if (!content) {
      toast.warning(MESSAGE_ACTION_LABELS.NO_CONTENT)
      return
    }
    const markdown = hasDataImage(content)
      ? stripDataImagesForText(content)
      : content
    const stem = deriveExportStem(markdown)
    setExporting(true)
    try {
      await exportMessage(markdown, format, stem)
    } catch {
      toast.error(t('Export failed'))
    } finally {
      setExporting(false)
    }
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

        {/* Export (assistant, text messages only) — md / docx / pdf, like the
            "export" affordance on ChatGPT/Claude answers. Hidden for image-only
            messages (nothing textual to export). */}
        {isAssistant && !isLoading && hasContent && !isImageOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={exporting}
              aria-label={t('Export')}
              className='text-muted-foreground hover:text-foreground hover:bg-muted flex size-7 items-center justify-center rounded-md outline-none transition-colors disabled:opacity-50'
            >
              <Download className='size-4' />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' className='w-40'>
              <DropdownMenuItem onSelect={() => handleExport('md')}>
                <FileText className='size-4' />
                {t('Markdown (.md)')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleExport('docx')}>
                <FileType className='size-4' />
                {t('Word (.docx)')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleExport('pdf')}>
                <FileDown className='size-4' />
                {t('PDF (.pdf)')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
