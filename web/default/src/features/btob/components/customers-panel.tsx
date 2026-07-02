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
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  sideDrawerContentClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatUserCode, parseUserCode } from '@/lib/user-code'
import { getUser, searchUsers, updateUser } from '@/features/users/api'
import type { User } from '@/features/users/types'
import { getB2BCustomers, getB2BPricing, moveB2BCustomer } from '../api'
import { B2B_GROUP } from '../lib'
import { B2BPricingPanel } from './pricing-panel'

// $1 of quota = 500000 internal units (project invariant).
const QUOTA_PER_DOLLAR = 500000

function usd(quota: number): string {
  return `$${(quota / QUOTA_PER_DOLLAR).toFixed(2)}`
}

// Built-in C-end groups that are never B2B move targets (they belong to the
// default/sample tiers, not the enterprise system).
const C_END_GROUPS = new Set(['default', 'vip', 'svip'])

// Special sentinels used as <Select> values (real group names can't collide:
// "" is used by the API for "auto dedicated group" but as a Select value we use
// __new__ to keep it visible/selectable).
const NEW_DEDICATED = '__new__'
const MOVE_OUT = 'default'

const isDedicated = (g: string) => g.startsWith('b2b_')

export function B2BCustomersPanel() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  // Which customer's per-customer pricing drawer is open (by user id).
  const [pricingUserId, setPricingUserId] = useState<number | null>(null)

  const customersQuery = useQuery({
    queryKey: ['btob-customers'],
    queryFn: getB2BCustomers,
  })
  const customers = useMemo(
    () => customersQuery.data?.data ?? [],
    [customersQuery.data]
  )

  // Existing B2B groups (for the change-group dropdown): the shared "btob" tier,
  // every dedicated group, and any shared tier — sourced from the pricing tables
  // plus whatever groups customers actually sit in (so a tier always appears
  // even before it has ratio entries). C-end groups are excluded.
  const b2bQuery = useQuery({ queryKey: ['btob-pricing'], queryFn: getB2BPricing })
  const existingGroups = useMemo<string[]>(() => {
    const set = new Set<string>([B2B_GROUP])
    try {
      const ratios = JSON.parse(b2bQuery.data?.data.group_ratio || '{}')
      for (const g of Object.keys(ratios)) {
        if (!C_END_GROUPS.has(g)) set.add(g)
      }
    } catch {
      /* ignore malformed */
    }
    for (const c of customers) {
      if (!C_END_GROUPS.has(c.group)) set.add(c.group)
    }
    // Stable order: btob first, then dedicated groups, then shared tiers.
    return Array.from(set).sort((a, b) => {
      if (a === B2B_GROUP) return -1
      if (b === B2B_GROUP) return 1
      const ad = isDedicated(a)
      const bd = isDedicated(b)
      if (ad !== bd) return ad ? -1 : 1
      return a.localeCompare(b)
    })
  }, [b2bQuery.data, customers])

  // Human label for a group name in this customer's context.
  const groupLabel = (g: string, ownerId?: number): string => {
    if (g === B2B_GROUP) return t('Overall default tier')
    if (isDedicated(g)) {
      if (ownerId != null && g === `b2b_${ownerId}`) return t('Dedicated group')
      return `${t('Dedicated group')} (${g})`
    }
    return g // shared tier — show its raw name
  }

  // Move a customer to a target group. NEW_DEDICATED -> auto b2b_<id> (group='').
  const moveMutation = useMutation({
    mutationFn: async ({ id, target }: { id: number; target: string }) => {
      const group = target === NEW_DEDICATED ? '' : target
      const res = await moveB2BCustomer({ user_id: id, group })
      if (!res.success) throw new Error(res.message || t('Update failed'))
    },
    onSuccess: () => {
      toast.success(t('Customer updated'))
      queryClient.invalidateQueries({ queryKey: ['btob-customers'] })
      queryClient.invalidateQueries({ queryKey: ['btob-pricing'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Add a user to B2B by username or numeric id, into a chosen target group.
  const [addInput, setAddInput] = useState('')
  const [addTarget, setAddTarget] = useState<string>(B2B_GROUP)
  const addMutation = useMutation({
    mutationFn: async (identifier: string) => {
      // Accept an AR code (AR000002), a raw numeric id, or a username. parseUserCode
      // handles the first two; fall back to a username/display-name search.
      const id = parseUserCode(identifier)
      let target: User | undefined
      if (id != null) {
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
      const group = addTarget === NEW_DEDICATED ? '' : addTarget
      const res = await moveB2BCustomer({ user_id: target.id, group })
      if (!res.success) throw new Error(res.message || t('Update failed'))
    },
    onSuccess: () => {
      toast.success(t('Customer added'))
      setAddInput('')
      queryClient.invalidateQueries({ queryKey: ['btob-customers'] })
      queryClient.invalidateQueries({ queryKey: ['btob-pricing'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const filtered = keyword
    ? customers.filter(
        (u) =>
          u.username.includes(keyword) ||
          u.display_name.includes(keyword) ||
          String(u.id) === keyword ||
          formatUserCode(u.id).includes(keyword.toUpperCase())
      )
    : customers

  // The customer whose pricing drawer is open — read live from the list so it
  // reflects a just-completed "convert to dedicated group" move.
  const pricingCustomer =
    pricingUserId != null
      ? customers.find((c) => c.id === pricingUserId) ?? null
      : null

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>{t('Add B2B customer')}</CardTitle>
          <CardDescription>
            {t(
              'Enter a username or user ID and pick the group to move them into.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex flex-wrap items-center gap-2'>
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
            <Select value={addTarget} onValueChange={setAddTarget}>
              <SelectTrigger className='w-52'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={B2B_GROUP}>
                  {t('Overall default tier')}
                </SelectItem>
                <SelectItem value={NEW_DEDICATED}>
                  {t('New dedicated group')}
                </SelectItem>
                {existingGroups
                  .filter((g) => g !== B2B_GROUP)
                  .map((g) => (
                    <SelectItem key={g} value={g}>
                      {groupLabel(g)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
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
            {t(
              'Every B2B customer — shared tier and per-customer dedicated groups. Change a customer’s group or set their own pricing.'
            )}
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
                  <TableHead>{t('Current group')}</TableHead>
                  <TableHead>{t('Balance')}</TableHead>
                  <TableHead>{t('Used')}</TableHead>
                  <TableHead>{t('Remark')}</TableHead>
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
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        <Badge
                          variant={
                            isDedicated(u.group) ? 'default' : 'secondary'
                          }
                        >
                          {groupLabel(u.group, u.id)}
                        </Badge>
                        <Select
                          value={u.group}
                          onValueChange={(target) => {
                            if (target !== u.group) {
                              moveMutation.mutate({ id: u.id, target })
                            }
                          }}
                          disabled={moveMutation.isPending}
                        >
                          <SelectTrigger className='h-7 w-40 text-xs'>
                            <SelectValue placeholder={t('Change group')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel>{t('Move to group')}</SelectLabel>
                              {existingGroups.map((g) => (
                                <SelectItem key={g} value={g}>
                                  {groupLabel(g, u.id)}
                                </SelectItem>
                              ))}
                              {/* This user's dedicated group isn't in the list
                                  yet if they've never had one. */}
                              {!existingGroups.includes(`b2b_${u.id}`) && (
                                <SelectItem value={NEW_DEDICATED}>
                                  {t('New dedicated group')}
                                </SelectItem>
                              )}
                            </SelectGroup>
                            <SelectSeparator />
                            <SelectItem value={MOVE_OUT}>
                              {t('Remove from B2B')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                    <TableCell>{usd(u.quota)}</TableCell>
                    <TableCell>{usd(u.used_quota)}</TableCell>
                    <TableCell>
                      <RemarkCell userId={u.id} value={u.remark ?? ''} />
                    </TableCell>
                    <TableCell className='space-x-2 text-right'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => setPricingUserId(u.id)}
                      >
                        {t('Set pricing')}
                      </Button>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() =>
                          navigate({
                            to: '/usage-logs/$section',
                            params: { section: 'common' },
                            search: {
                              username: formatUserCode(u.id),
                              type: [2],
                            } as never,
                          })
                        }
                      >
                        {t('View usage')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Per-customer pricing drawer. */}
      <Sheet
        open={pricingUserId != null}
        onOpenChange={(v) => !v && setPricingUserId(null)}
      >
        <SheetContent className={sideDrawerContentClassName('sm:max-w-2xl')}>
          <SheetHeader className={sideDrawerHeaderClassName()}>
            <SheetTitle>
              {t('Pricing for')}{' '}
              {pricingCustomer
                ? pricingCustomer.display_name ||
                  formatUserCode(pricingCustomer.id)
                : ''}
            </SheetTitle>
            <SheetDescription>
              {pricingCustomer
                ? groupLabel(pricingCustomer.group, pricingCustomer.id)
                : ''}
            </SheetDescription>
          </SheetHeader>
          <div className='overflow-y-auto px-4 pb-6'>
            {pricingCustomer &&
              (pricingCustomer.group === B2B_GROUP ? (
                // Shared tier: editing it would change ALL btob customers. Make
                // them a dedicated group first, then price that.
                <div className='space-y-3 py-4'>
                  <p className='text-muted-foreground text-sm'>
                    {t(
                      'This customer bills under the shared tier. Convert them to a dedicated group to set their own pricing without affecting others.'
                    )}
                  </p>
                  <Button
                    onClick={() =>
                      moveMutation.mutate({
                        id: pricingCustomer.id,
                        target: NEW_DEDICATED,
                      })
                    }
                    disabled={moveMutation.isPending}
                  >
                    {moveMutation.isPending && (
                      <Spinner className='mr-2 size-4' />
                    )}
                    {t('Convert to dedicated group')}
                  </Button>
                </div>
              ) : (
                <div className='py-4'>
                  <B2BPricingPanel
                    group={pricingCustomer.group}
                    showProvision={false}
                    showNotes={false}
                  />
                </div>
              ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

// RemarkCell renders a customer's remark as inline-editable text: click to edit,
// Enter / blur to save, Esc to cancel. Persists to User.remark (shared with the
// global user list). Fetches the full user before saving so Edit's validated
// fields (username/display_name/group) are preserved — only remark changes.
function RemarkCell({ userId, value }: { userId: number; value: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const remarkMutation = useMutation({
    mutationFn: async (remark: string) => {
      const res = await getUser(userId)
      if (!res.success || !res.data) {
        throw new Error(res.message || t('User not found'))
      }
      const u = res.data
      const upd = await updateUser({
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        group: u.group,
        remark,
      })
      if (!upd.success) throw new Error(upd.message || t('Update failed'))
    },
    onSuccess: () => {
      toast.success(t('Remark saved'))
      queryClient.invalidateQueries({ queryKey: ['btob-customers'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next !== value) remarkMutation.mutate(next)
  }

  if (editing) {
    return (
      <div className='flex items-center gap-1'>
        <Input
          autoFocus
          className='h-7 max-w-[160px] text-xs'
          value={draft}
          maxLength={255}
          placeholder={t('Add remark')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(value)
              setEditing(false)
            }
          }}
        />
        {remarkMutation.isPending && <Spinner className='size-3.5' />}
      </div>
    )
  }

  return (
    <button
      type='button'
      className='hover:bg-muted text-muted-foreground max-w-[160px] truncate rounded px-2 py-1 text-left text-xs'
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      title={value || t('Add remark')}
    >
      {value || <span className='opacity-50'>{t('Add remark')}</span>}
    </button>
  )
}
