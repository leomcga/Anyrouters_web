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
import { useEffect, useRef, useState } from 'react'
import { Send, ImagePlus, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { parseTicketContent } from '../lib'
import type { Ticket } from '../types'

// One rendered message bubble. Own messages align right; the counterpart left.
function MessageBubble({
  role,
  name,
  content,
  createdAt,
  mine,
}: {
  role: 'user' | 'admin'
  name: string
  content: string
  createdAt: number
  mine: boolean
}) {
  const { t } = useTranslation()
  const parts = parseTicketContent(content)
  const who = role === 'admin' ? t('Support') : name || t('User')
  return (
    <div
      className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}
    >
      <div className='text-muted-foreground px-1 text-[11px]'>
        {who} · {formatTimestamp(createdAt)}
      </div>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap',
          mine
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted rounded-bl-sm'
        )}
      >
        {parts.map((p, i) =>
          p.type === 'image' ? (
            <img
              key={i}
              src={p.value}
              alt=''
              className='my-1 max-h-72 max-w-full rounded-lg border'
            />
          ) : (
            <span key={i}>{p.value}</span>
          )
        )}
      </div>
    </div>
  )
}

/**
 * Ticket thread + reply composer, shared by the user and admin pages. `role`
 * decides which side is "mine" and whether the composer is disabled once
 * closed (the user can reopen by replying; staff too).
 */
export function TicketThread({
  ticket,
  role,
  onReply,
  sending,
}: {
  ticket: Ticket
  role: 'user' | 'admin'
  onReply: (content: string) => Promise<void>
  sending: boolean
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Stick to the newest message whenever the thread grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [ticket.messages?.length])

  const addFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .forEach((f) => {
        if (f.size > 3 * 1024 * 1024) {
          toast.error(t('Image too large (max 3MB).'))
          return
        }
        const reader = new FileReader()
        reader.onload = () =>
          setImages((prev) => [...prev, String(reader.result)])
        reader.readAsDataURL(f)
      })
  }

  const submit = async () => {
    const body = [text.trim(), ...images.map((src) => `![image](${src})`)]
      .filter(Boolean)
      .join('\n\n')
    if (!body) return
    await onReply(body)
    setText('')
    setImages([])
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div ref={scrollRef} className='flex-1 space-y-4 overflow-y-auto p-4'>
        {(ticket.messages ?? []).map((m) => (
          <MessageBubble
            key={m.id}
            role={m.author_role}
            name={m.author_name}
            content={m.content}
            createdAt={m.created_at}
            mine={m.author_role === role}
          />
        ))}
      </div>

      <div className='border-t p-3'>
        {images.length > 0 && (
          <div className='mb-2 flex flex-wrap gap-2'>
            {images.map((src, i) => (
              <div key={i} className='relative'>
                <img
                  src={src}
                  alt=''
                  className='size-14 rounded-md border object-cover'
                />
                <button
                  type='button'
                  onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                  className='bg-background absolute -top-1.5 -right-1.5 rounded-full border p-0.5'
                >
                  <X className='size-3' />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className='flex items-end gap-2'>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => addFiles(e.clipboardData?.files ?? null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            placeholder={t('Type your message… (⌘/Ctrl+Enter to send)')}
            className='max-h-40 min-h-11 flex-1 resize-none'
          />
          <input
            ref={fileRef}
            type='file'
            accept='image/*'
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <Button
            type='button'
            variant='outline'
            size='icon'
            onClick={() => fileRef.current?.click()}
            title={t('Attach image')}
          >
            <ImagePlus className='size-4' />
          </Button>
          <Button
            type='button'
            onClick={submit}
            disabled={sending || (!text.trim() && images.length === 0)}
            title={t('Send')}
          >
            {sending ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Send className='size-4' />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
