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
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { type ChatSession, MAX_SESSIONS } from '../lib'

interface ChatHistoryProps {
  sessions: ChatSession[]
  activeId: string
  /** While a response is streaming, switching conversations is locked. */
  disabled?: boolean
  onNewChat: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

export function ChatHistory({
  sessions,
  activeId,
  disabled = false,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
}: ChatHistoryProps) {
  const { t } = useTranslation()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const startRename = (session: ChatSession) => {
    setRenamingId(session.id)
    setRenameValue(session.title || '')
  }

  const commitRename = () => {
    if (!renamingId) return
    onRename(renamingId, renameValue)
    setRenamingId(null)
    setRenameValue('')
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
  }

  return (
    <aside className='hidden w-64 shrink-0 flex-col border-r border-border/60 bg-muted/20 md:flex'>
      <div className='p-3'>
        <Button
          variant='outline'
          size='sm'
          className='w-full justify-start gap-2 bg-background'
          onClick={onNewChat}
          disabled={disabled}
        >
          <Plus className='size-4' />
          {t('New Chat')}
        </Button>
      </div>

      <div className='flex items-baseline justify-between px-3 pb-1'>
        <span className='text-xs font-medium text-muted-foreground/60'>
          {t('Chat History')}
        </span>
        {/* Show the count as we approach the cap so users know the oldest
            conversations will be dropped (kept: most recent MAX_SESSIONS). */}
        {sessions.length >= MAX_SESSIONS - 5 && (
          <span
            className='text-[11px] text-muted-foreground/60'
            title={t('Only the most recent {{max}} conversations are kept. Export anything you want to keep.', { max: MAX_SESSIONS })}
          >
            {sessions.length}/{MAX_SESSIONS}
          </span>
        )}
      </div>

      <ScrollArea className='flex-1'>
        <div
          className={cn(
            'space-y-0.5 px-2 pb-3',
            disabled && 'pointer-events-none opacity-60'
          )}
        >
          {sessions.map((session) => {
            const isActive = session.id === activeId
            const label = session.title || t('New Chat')

            if (renamingId === session.id) {
              return (
                <Input
                  key={session.id}
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    else if (e.key === 'Escape') cancelRename()
                  }}
                  onBlur={commitRename}
                  className='h-9 text-sm'
                />
              )
            }

            return (
              <div
                key={session.id}
                className={cn(
                  'group/item relative flex items-center rounded-lg pr-1',
                  isActive ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <button
                  type='button'
                  onClick={() => onSelect(session.id)}
                  title={label}
                  className={cn(
                    'min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    isActive
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  {label}
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label='More'
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition',
                      'hover:bg-background hover:text-foreground',
                      'opacity-0 group-hover/item:opacity-100 data-[state=open]:opacity-100',
                      'focus-visible:ring-ring/40 focus-visible:opacity-100 focus-visible:ring-2'
                    )}
                  >
                    <MoreHorizontal className='size-4' />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-36'>
                    <DropdownMenuItem onSelect={() => startRename(session)}>
                      <Pencil className='size-4' />
                      {t('Rename')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className='text-destructive focus:text-destructive'
                      onSelect={() => setDeletingId(session.id)}
                    >
                      <Trash2 className='size-4' />
                      {t('Delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          })}
        </div>
      </ScrollArea>

      <AlertDialog
        open={!!deletingId}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('Delete this conversation?')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('This conversation will be permanently removed.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-white hover:bg-destructive/90'
              onClick={() => {
                if (deletingId) onDelete(deletingId)
                setDeletingId(null)
              }}
            >
              {t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
