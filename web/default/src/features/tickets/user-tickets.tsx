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
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, ArrowLeft, LifeBuoy, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTimestamp } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Empty } from '@/components/ui/empty'
import {
  listSelfTickets,
  getSelfTicket,
  createTicket,
  replySelfTicket,
} from './api'
import { statusBadgeClass, statusMeta } from './lib'
import { TicketThread } from './components/ticket-thread'
import type { Ticket } from './types'

export function UserTickets() {
  const { t } = useTranslation()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<Ticket | null>(null)
  const [composing, setComposing] = useState(false)
  const [sending, setSending] = useState(false)
  const [title, setTitle] = useState('')
  const [firstMsg, setFirstMsg] = useState('')

  const refreshList = useCallback(async () => {
    try {
      setTickets(await listSelfTickets())
    } catch {
      /* keep prior list */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  const openTicket = async (id: number) => {
    try {
      const full = await getSelfTicket(id)
      setActive(full)
      setComposing(false)
      // Clearing unread on the server; reflect it in the list too.
      setTickets((prev) =>
        prev.map((x) => (x.id === id ? { ...x, user_unread: false } : x))
      )
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const submitNew = async () => {
    if (!title.trim() || !firstMsg.trim()) {
      toast.error(t('Please enter a title and a description.'))
      return
    }
    setSending(true)
    try {
      const created = await createTicket(title.trim(), firstMsg.trim())
      setTitle('')
      setFirstMsg('')
      await refreshList()
      await openTicket(created.id)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const reply = async (content: string) => {
    if (!active) return
    setSending(true)
    try {
      const updated = await replySelfTicket(active.id, content)
      setActive(updated)
      void refreshList()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  // --- Thread view ---
  if (active) {
    const meta = statusMeta(active.status)
    return (
      <div className='mx-auto flex h-full max-w-3xl flex-col p-4'>
        <div className='mb-3 flex items-center gap-3'>
          <Button variant='ghost' size='icon' onClick={() => setActive(null)}>
            <ArrowLeft className='size-4' />
          </Button>
          <div className='min-w-0 flex-1'>
            <div className='truncate font-medium'>{active.title}</div>
          </div>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              statusBadgeClass(meta.tone)
            )}
          >
            {t(meta.key)}
          </span>
        </div>
        <div className='min-h-0 flex-1 rounded-xl border'>
          <TicketThread
            ticket={active}
            role='user'
            onReply={reply}
            sending={sending}
          />
        </div>
      </div>
    )
  }

  // --- New ticket form ---
  if (composing) {
    return (
      <div className='mx-auto max-w-2xl p-4'>
        <div className='mb-4 flex items-center gap-3'>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => setComposing(false)}
          >
            <ArrowLeft className='size-4' />
          </Button>
          <h1 className='text-lg font-semibold'>{t('New ticket')}</h1>
        </div>
        <div className='space-y-3'>
          <div>
            <label className='mb-1 block text-sm font-medium'>
              {t('Subject')}
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('e.g. Payment succeeded but balance not credited')}
              maxLength={200}
            />
          </div>
          <div>
            <label className='mb-1 block text-sm font-medium'>
              {t('Describe your issue')}
            </label>
            <Textarea
              value={firstMsg}
              onChange={(e) => setFirstMsg(e.target.value)}
              placeholder={t(
                'What happened, and any details that help us reproduce it. You can attach screenshots after creating.'
              )}
              className='min-h-40'
            />
          </div>
          <div className='flex justify-end'>
            <Button onClick={submitNew} disabled={sending}>
              {sending && <Loader2 className='mr-2 size-4 animate-spin' />}
              {t('Create ticket')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // --- List view ---
  return (
    <div className='mx-auto max-w-2xl p-4'>
      <div className='mb-4 flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <LifeBuoy className='text-primary size-5' />
          <h1 className='text-lg font-semibold'>{t('My Tickets')}</h1>
        </div>
        <Button size='sm' onClick={() => setComposing(true)}>
          <Plus className='mr-1 size-4' />
          {t('New ticket')}
        </Button>
      </div>

      {loading ? (
        <div className='text-muted-foreground flex items-center gap-2 p-8 text-sm'>
          <Loader2 className='size-4 animate-spin' /> {t('Loading…')}
        </div>
      ) : tickets.length === 0 ? (
        <Empty className='py-16'>
          <LifeBuoy className='text-muted-foreground/50 mb-2 size-8' />
          <p className='text-muted-foreground text-sm'>
            {t('No tickets yet. Have a question? Open one and we’ll help.')}
          </p>
          <Button
            size='sm'
            className='mt-3'
            onClick={() => setComposing(true)}
          >
            <Plus className='mr-1 size-4' />
            {t('New ticket')}
          </Button>
        </Empty>
      ) : (
        <div className='space-y-2'>
          {tickets.map((tk) => {
            const meta = statusMeta(tk.status)
            return (
              <button
                key={tk.id}
                type='button'
                onClick={() => openTicket(tk.id)}
                className='hover:bg-muted/50 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors'
              >
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2'>
                    <span className='truncate font-medium'>{tk.title}</span>
                    {tk.user_unread && (
                      <span className='bg-primary size-2 shrink-0 rounded-full' />
                    )}
                  </div>
                  <div className='text-muted-foreground text-xs'>
                    {formatTimestamp(tk.updated_at)}
                  </div>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                    statusBadgeClass(meta.tone)
                  )}
                >
                  {t(meta.key)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
