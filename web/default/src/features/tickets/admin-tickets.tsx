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
import { ArrowLeft, LifeBuoy, Loader2, CheckCircle2, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTimestamp } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'
import {
  listAdminTickets,
  getAdminTicket,
  replyAdminTicket,
  setAdminTicketStatus,
} from './api'
import { statusBadgeClass, statusMeta } from './lib'
import { TicketThread } from './components/ticket-thread'
import type { Ticket, TicketStatus } from './types'

const FILTERS: Array<{ value: '' | TicketStatus; key: string }> = [
  { value: '', key: 'All' },
  { value: 'open', key: 'Awaiting reply' },
  { value: 'replied', key: 'Replied' },
  { value: 'closed', key: 'Closed' },
]

export function AdminTickets() {
  const { t } = useTranslation()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [filter, setFilter] = useState<'' | TicketStatus>('')
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<Ticket | null>(null)
  const [sending, setSending] = useState(false)

  const refreshList = useCallback(async () => {
    try {
      const res = await listAdminTickets(filter)
      setTickets(res.items)
    } catch {
      /* keep prior */
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    setLoading(true)
    void refreshList()
  }, [refreshList])

  const open = async (id: number) => {
    try {
      const full = await getAdminTicket(id)
      setActive(full)
      setTickets((prev) =>
        prev.map((x) => (x.id === id ? { ...x, admin_unread: false } : x))
      )
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const reply = async (content: string) => {
    if (!active) return
    setSending(true)
    try {
      setActive(await replyAdminTicket(active.id, content))
      void refreshList()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const toggleClose = async () => {
    if (!active) return
    const next = active.status === 'closed' ? 'open' : 'closed'
    try {
      await setAdminTicketStatus(active.id, next)
      setActive({ ...active, status: next })
      void refreshList()
    } catch (e) {
      toast.error((e as Error).message)
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
            <div className='text-muted-foreground text-xs'>
              {active.user_name} · {active.user_code}
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
          <Button variant='outline' size='sm' onClick={toggleClose}>
            {active.status === 'closed' ? (
              <>
                <RotateCcw className='mr-1 size-4' />
                {t('Reopen')}
              </>
            ) : (
              <>
                <CheckCircle2 className='mr-1 size-4' />
                {t('Close')}
              </>
            )}
          </Button>
        </div>
        <div className='min-h-0 flex-1 rounded-xl border'>
          <TicketThread
            ticket={active}
            role='admin'
            onReply={reply}
            sending={sending}
          />
        </div>
      </div>
    )
  }

  // --- List view ---
  return (
    <div className='mx-auto max-w-3xl p-4'>
      <div className='mb-4 flex items-center gap-2'>
        <LifeBuoy className='text-primary size-5' />
        <h1 className='text-lg font-semibold'>{t('Support Tickets')}</h1>
      </div>

      <div className='mb-3 flex gap-1'>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type='button'
            onClick={() => setFilter(f.value)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs transition-colors',
              filter === f.value
                ? 'border-foreground bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            {t(f.key)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className='text-muted-foreground flex items-center gap-2 p-8 text-sm'>
          <Loader2 className='size-4 animate-spin' /> {t('Loading…')}
        </div>
      ) : tickets.length === 0 ? (
        <Empty className='py-16'>
          <LifeBuoy className='text-muted-foreground/50 mb-2 size-8' />
          <p className='text-muted-foreground text-sm'>{t('No tickets.')}</p>
        </Empty>
      ) : (
        <div className='space-y-2'>
          {tickets.map((tk) => {
            const meta = statusMeta(tk.status)
            return (
              <button
                key={tk.id}
                type='button'
                onClick={() => open(tk.id)}
                className='hover:bg-muted/50 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors'
              >
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2'>
                    <span className='truncate font-medium'>{tk.title}</span>
                    {tk.admin_unread && (
                      <span className='bg-primary size-2 shrink-0 rounded-full' />
                    )}
                  </div>
                  <div className='text-muted-foreground text-xs'>
                    {tk.user_name} · {tk.user_code} · {formatTimestamp(tk.updated_at)}
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
