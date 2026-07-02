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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatUserCode } from '@/lib/user-code'
import { getUser, searchUsers, updateUser } from '@/features/users/api'
import type { User } from '@/features/users/types'
import { B2B_GROUP } from '../lib'

// $1 of quota = 500000 internal units (project invariant).
const QUOTA_PER_DOLLAR = 500000

function usd(quota: number): string {
  return `$${(quota / QUOTA_PER_DOLLAR).toFixed(2)}`
}

export function B2BCustomersPanel() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')

  const customersQuery = useQuery({
    queryKey: ['btob-customers'],
    queryFn: () => searchUsers({ group: B2B_GROUP, page_size: 100 }),
  })
  const customers = customersQuery.data?.data?.items ?? []

  // Move a user in/out of the B2B group. We fetch the full user first so Edit's
  // validated fields (username/display_name) are preserved — only group changes.
  const moveMutation = useMutation({
    mutationFn: async ({ id, group }: { id: number; group: string }) => {
      const res = await getUser(id)
      if (!res.success || !res.data) {
        throw new Error(res.message || t('User not found'))
      }
      const u = res.data
      const upd = await updateUser({
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        group,
      })
      if (!upd.success) throw new Error(upd.message || t('Update failed'))
    },
    onSuccess: () => {
      toast.success(t('Customer updated'))
      queryClient.invalidateQueries({ queryKey: ['btob-customers'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Add by username or numeric id.
  const [addInput, setAddInput] = useState('')
  const addMutation = useMutation({
    mutationFn: async (identifier: string) => {
      const id = Number(identifier)
      let target: User | undefined
      if (Number.isFinite(id) && id > 0) {
        const res = await getUser(id)
        if (res.success && res.data) target = res.data
      }
      if (!target) {
        const res = await searchUsers({ keyword: identifier, page_size: 10 })
        target = res.data?.items?.find(
          (u) => u.username === identifier || u.display_name === identifier
        )
      }
      if (!target) throw new Error(t('User not found'))
      const upd = await updateUser({
        id: target.id,
        username: target.username,
        display_name: target.display_name,
        group: B2B_GROUP,
      })
      if (!upd.success) throw new Error(upd.message || t('Update failed'))
    },
    onSuccess: () => {
      toast.success(t('Customer added'))
      setAddInput('')
      queryClient.invalidateQueries({ queryKey: ['btob-customers'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const filtered = keyword
    ? customers.filter(
        (u) =>
          u.username.includes(keyword) ||
          u.display_name.includes(keyword) ||
          String(u.id) === keyword
      )
    : customers

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>{t('Add B2B customer')}</CardTitle>
          <CardDescription>
            {t('Enter a username or user ID to move them into the B2B group.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex items-center gap-2'>
            <Input
              className='max-w-xs'
              placeholder={t('Username or ID')}
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && addInput.trim()) {
                  addMutation.mutate(addInput.trim())
                }
              }}
            />
            <Button
              onClick={() =>
                addInput.trim() && addMutation.mutate(addInput.trim())
              }
              disabled={addMutation.isPending || !addInput.trim()}
            >
              {addMutation.isPending && <Spinner className='mr-2 size-4' />}
              {t('Add')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('B2B customers')} ({customers.length})
          </CardTitle>
          <CardDescription>
            {t('Users currently in the B2B group and their usage.')}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <Input
            className='max-w-xs'
            placeholder={t('Filter by name / ID')}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {customersQuery.isLoading ? (
            <div className='flex justify-center py-8'>
              <Spinner />
            </div>
          ) : filtered.length === 0 ? (
            <p className='text-muted-foreground py-8 text-center text-sm'>
              {t('No B2B customers yet.')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('User Code')}</TableHead>
                  <TableHead>{t('User')}</TableHead>
                  <TableHead>{t('Balance')}</TableHead>
                  <TableHead>{t('Used')}</TableHead>
                  <TableHead className='text-right'>{t('Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className='font-mono'>
                      {formatUserCode(u.id)}
                    </TableCell>
                    <TableCell>
                      <div className='font-medium'>{u.display_name}</div>
                      <div className='text-muted-foreground text-xs'>
                        {u.username}
                      </div>
                    </TableCell>
                    <TableCell>{usd(u.quota)}</TableCell>
                    <TableCell>{usd(u.used_quota)}</TableCell>
                    <TableCell className='space-x-2 text-right'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() =>
                          navigate({
                            to: '/usage-logs/$section',
                            params: { section: 'common' },
                            // Pass the user code into the search box; the log
                            // filter maps it to a user_id query.
                            search: {
                              username: formatUserCode(u.id),
                              type: [2],
                            } as never,
                          })
                        }
                      >
                        {t('View usage')}
                      </Button>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() =>
                          moveMutation.mutate({ id: u.id, group: 'default' })
                        }
                        disabled={moveMutation.isPending}
                      >
                        {t('Remove')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
