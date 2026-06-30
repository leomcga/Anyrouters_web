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
import { ImageIcon, SendIcon, SquareIcon, XIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { ModelGroupSelector } from '@/components/model-group-selector'
import type { ModelOption, GroupOption } from '../types'

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
}

// Read image files into data URLs (skips non-images), for drop / paste / upload.
function readImageFiles(files: FileList | File[]): Promise<string[]> {
  const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'))
  return Promise.all(
    imgs.map(
      (f) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => resolve('')
          reader.readAsDataURL(f)
        })
    )
  ).then((urls) => urls.filter(Boolean))
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
}: PlaygroundInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const isModelSelectDisabled =
    disabled || isModelLoading || models.length === 0
  const isGroupSelectDisabled = disabled || groups.length === 0

  const handleSubmit = (message: PromptInputMessage) => {
    if (!message.text?.trim() || disabled) return
    onSubmit(message.text)
    setText('')
  }

  const ingestFiles = async (files: FileList | File[]) => {
    if (!onAddImages || disabled) return
    const urls = await readImageFiles(files)
    if (urls.length) onAddImages(urls)
  }

  const handlePickFile = () => fileInputRef.current?.click()

  // Drag & drop an image onto the composer.
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

  return (
    <div className='grid shrink-0 gap-4 px-1 md:pb-4'>
      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
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
          {hasImages && (
            <div className='flex flex-wrap items-center gap-2 px-3 pt-3'>
              {images!.map((src, i) => (
                <span
                  key={i}
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

        <PromptInputFooter className='p-2.5'>
          <PromptInputTools>
            {/* Attach an image: opens the file picker. Users can also drag an
                image onto the box or paste one. Sent as image_url so vision /
                image-edit models (Nano Banana) can use it. */}
            <PromptInputButton
              className='border font-medium'
              disabled={disabled}
              variant='outline'
              type='button'
              onClick={handlePickFile}
            >
              <ImageIcon size={16} />
              <span className='hidden sm:inline'>{t('Attach image')}</span>
              <span className='sr-only sm:hidden'>{t('Attach image')}</span>
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
            {t('Drop image to attach')}
          </div>
        )}
      </div>
    </div>
  )
}
