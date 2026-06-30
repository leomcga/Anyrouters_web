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
import { useRef, useState } from 'react'
import {
  FileTextIcon,
  PaperclipIcon,
  SendIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { ModelGroupSelector } from '@/components/model-group-selector'
import { cn } from '@/lib/utils'
import type { ModelOption, GroupOption, AttachedFile } from '../types'
import {
  ASPECT_RATIOS,
  imageModelKind,
  supportsDocumentInput,
  type AspectRatio,
  type ImageGenOptions,
  type ImageQuality,
} from '../lib/image-models'

interface PlaygroundInputProps {
  onSubmit: (text: string) => void
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  models: ModelOption[]
  modelValue: string
  onModelChange: (value: string) => void
  isModelLoading?: boolean
  groups: GroupOption[]
  groupValue: string
  onGroupChange: (value: string) => void
  // Images staged to send with the next message (data URLs), from edit / drag /
  // paste / upload. Shown as removable thumbnail chips above the textarea.
  images?: string[]
  onAddImages?: (dataUrls: string[]) => void
  onRemoveImage?: (index: number) => void
  // Documents (PDF/text) staged to send with the next message. Shown as named
  // chips; only offered for models that accept document input.
  files?: AttachedFile[]
  onAddFiles?: (files: AttachedFile[]) => void
  onRemoveFile?: (index: number) => void
  // Image-generation options (aspect ratio / quality). Rendered as an inline bar
  // only when the selected model is an image model; the quality control shows
  // only for the OpenAI image family (gpt-image-2). Driven from the parent so the
  // send path can read them.
  imageOptions?: ImageGenOptions
  onImageOptionsChange?: (next: ImageGenOptions) => void
}

// Read one file into a base64 data URL (empty string on error).
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => resolve('')
    reader.readAsDataURL(file)
  })
}

export function PlaygroundInput({
  onSubmit,
  onStop,
  disabled,
  isGenerating,
  models,
  modelValue,
  onModelChange,
  isModelLoading = false,
  groups,
  groupValue,
  onGroupChange,
  images,
  onAddImages,
  onRemoveImage,
  files,
  onAddFiles,
  onRemoveFile,
  imageOptions,
  onImageOptionsChange,
}: PlaygroundInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // Generation-options bar visibility: only for image models. Quality is only
  // meaningful for the OpenAI image family (gpt-image-2); Gemini image models
  // have aspect ratio only.
  const kind = imageModelKind(modelValue)
  const showImageOptions = kind !== null && !!imageOptions
  const showQuality = kind === 'openai'
  // Whether the current model accepts non-image documents (Claude / GPT / …).
  const allowDocs = supportsDocumentInput(modelValue)

  const isModelSelectDisabled =
    disabled || isModelLoading || models.length === 0
  const isGroupSelectDisabled = disabled || groups.length === 0

  const handleSubmit = (message: PromptInputMessage) => {
    if (!message.text?.trim() || disabled) return
    onSubmit(message.text)
    setText('')
  }

  const ingestFiles = async (incoming: FileList | File[]) => {
    if (disabled) return
    const all = Array.from(incoming)
    const imgs = all.filter((f) => f.type.startsWith('image/'))
    const docs = all.filter((f) => !f.type.startsWith('image/'))

    // Images: always sent as image_url (vision / image-edit).
    if (imgs.length && onAddImages) {
      const urls = (await Promise.all(imgs.map(readFileAsDataUrl))).filter(
        Boolean
      )
      if (urls.length) onAddImages(urls)
    }

    // Documents: only for models that accept document input. For an image-gen
    // model (or any model that doesn't take files), warn instead of silently
    // dropping, so the affordance isn't a lie.
    if (docs.length) {
      if (!allowDocs || !onAddFiles) {
        toast.info(t('This model does not support file attachments'))
      } else {
        const read = await Promise.all(
          docs.map(async (f) => ({
            name: f.name,
            dataUrl: await readFileAsDataUrl(f),
          }))
        )
        const valid = read.filter((f) => f.dataUrl)
        if (valid.length) onAddFiles(valid)
      }
    }
  }

  const handlePickFile = () => fileInputRef.current?.click()

  // Drag & drop a file (any type) onto the composer; images are kept, other
  // files surface the "only images for now" notice via ingestFiles.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer?.files?.length) void ingestFiles(e.dataTransfer.files)
  }
  // Paste an image (Ctrl/Cmd+V) into the composer.
  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.items || [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f)
    if (files.length) {
      e.preventDefault()
      void ingestFiles(files)
    }
  }

  const hasImages = !!images?.length
  const hasFiles = !!files?.length

  return (
    <div className='grid shrink-0 gap-4 px-1 md:pb-4'>
      <input
        ref={fileInputRef}
        type='file'
        multiple
        className='hidden'
        onChange={(e) => {
          if (e.target.files?.length) void ingestFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <div
        className='relative'
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault()
            setDragOver(true)
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDragOver(false)
        }}
        onDrop={handleDrop}
      >
        <PromptInput groupClassName='rounded-xl' onSubmit={handleSubmit}>
          {(hasImages || hasFiles) && (
            <div className='flex flex-wrap items-center gap-2 px-3 pt-3'>
              {images?.map((src, i) => (
                <span
                  key={`img-${i}`}
                  className='group/chip relative inline-block shrink-0'
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={t('Attached image')}
                    className='border-primary/30 h-14 w-14 rounded-lg border-2 object-cover'
                  />
                  <button
                    type='button'
                    onClick={() => onRemoveImage?.(i)}
                    className='bg-background absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border shadow-sm'
                    title={t('Remove')}
                  >
                    <XIcon size={12} />
                  </button>
                </span>
              ))}
              {files?.map((f, i) => (
                <span
                  key={`file-${i}`}
                  className='bg-muted/60 relative inline-flex max-w-[12rem] items-center gap-2 rounded-lg border py-2 pl-2.5 pr-7'
                  title={f.name}
                >
                  <FileTextIcon className='text-primary size-5 shrink-0' />
                  <span className='truncate text-xs font-medium'>{f.name}</span>
                  <button
                    type='button'
                    onClick={() => onRemoveFile?.(i)}
                    className='bg-background absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border shadow-sm'
                    title={t('Remove')}
                  >
                    <XIcon size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <PromptInputTextarea
            autoComplete='off'
            autoCorrect='off'
            autoCapitalize='off'
            spellCheck={false}
            className='px-5 md:text-base'
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
            onPaste={handlePaste}
            placeholder={t('Ask anything')}
            value={text}
          />

        {/* Image-generation options bar — only for image models. Lets the user
            pick an aspect ratio (both families) and, for gpt-image-2, a quality.
            Text models never see this row. */}
        {showImageOptions && (
          <div className='flex flex-wrap items-center gap-2 px-3 pt-2.5 text-xs'>
            <span className='text-muted-foreground font-medium'>
              {t('Aspect ratio')}
            </span>
            <div className='flex flex-wrap items-center gap-1'>
              {ASPECT_RATIOS.map((r) => (
                <button
                  key={r}
                  type='button'
                  disabled={disabled}
                  onClick={() =>
                    onImageOptionsChange?.({
                      ...imageOptions!,
                      aspectRatio: r as AspectRatio,
                    })
                  }
                  className={cn(
                    'rounded-md border px-2 py-1 font-medium transition-colors',
                    imageOptions!.aspectRatio === r
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted border-transparent'
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            {showQuality && (
              <>
                <span className='bg-border mx-1 hidden h-4 w-px sm:inline-block' />
                <span className='text-muted-foreground font-medium'>
                  {t('Quality')}
                </span>
                <div className='flex items-center gap-1'>
                  {(
                    [
                      ['standard', t('Standard')],
                      ['high', t('High')],
                    ] as Array<[ImageQuality, string]>
                  ).map(([q, label]) => (
                    <button
                      key={q}
                      type='button'
                      disabled={disabled}
                      onClick={() =>
                        onImageOptionsChange?.({
                          ...imageOptions!,
                          quality: q,
                        })
                      }
                      className={cn(
                        'rounded-md border px-2 py-1 font-medium transition-colors',
                        imageOptions!.quality === q
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-muted border-transparent'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <PromptInputFooter className='p-2.5'>
          <PromptInputTools>
            {/* Attach a file: opens the picker. Users can also drag a file onto
                the box or paste an image. Images are sent as image_url so vision
                / image-edit models (Nano Banana) can use them. */}
            <PromptInputButton
              className='border font-medium'
              disabled={disabled}
              variant='outline'
              type='button'
              onClick={handlePickFile}
            >
              <PaperclipIcon size={16} />
              <span className='hidden sm:inline'>{t('Attach file')}</span>
              <span className='sr-only sm:hidden'>{t('Attach file')}</span>
            </PromptInputButton>
          </PromptInputTools>

          <div className='flex items-center gap-1.5 md:gap-2'>
            <ModelGroupSelector
              selectedModel={modelValue}
              models={models}
              onModelChange={onModelChange}
              selectedGroup={groupValue}
              groups={groups}
              onGroupChange={onGroupChange}
              disabled={isModelSelectDisabled || isGroupSelectDisabled}
            />

            {isGenerating && onStop ? (
              <PromptInputButton
                className='text-foreground font-medium'
                onClick={onStop}
                variant='secondary'
              >
                <SquareIcon className='fill-current' size={16} />
                <span className='hidden sm:inline'>{t('Stop')}</span>
                <span className='sr-only sm:hidden'>{t('Stop')}</span>
              </PromptInputButton>
            ) : (
              <PromptInputButton
                className='text-foreground font-medium'
                disabled={disabled || !text.trim()}
                type='submit'
                variant='secondary'
              >
                <SendIcon size={16} />
                <span className='hidden sm:inline'>{t('Send')}</span>
                <span className='sr-only sm:hidden'>{t('Send')}</span>
              </PromptInputButton>
            )}
          </div>
        </PromptInputFooter>
        </PromptInput>
        {dragOver && (
          <div className='bg-primary/5 border-primary/40 text-primary pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed text-sm font-medium backdrop-blur-sm'>
            {t('Drop file to attach')}
          </div>
        )}
      </div>
    </div>
  )
}
