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
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { getPricing } from '@/features/pricing/api'
import type { PricingModel, PricingVendor } from '@/features/pricing/types'
import { getB2BPricing, provisionB2BGroup, updateB2BPricing } from '../api'
import {
  B2B_GROUP,
  computeOverride,
  formatDiscount,
  getCEndDiscount,
} from '../lib'

type VendorGroup = {
  vendor: PricingVendor
  models: PricingModel[]
}

export function B2BPricingPanel() {
  const { t, i18n } = useTranslation()
  const zh = i18n.language?.startsWith('zh') ?? false
  const queryClient = useQueryClient()

  // Per-vendor target discount input (relative to official price). Percent form
  // in the UI (e.g. 85 = 8.5折 / 85%), converted to a 0-1 rate on save.
  const [targets, setTargets] = useState<Record<number, string>>({})

  const pricingQuery = useQuery({ queryKey: ['pricing'], queryFn: getPricing })
  const b2bQuery = useQuery({ queryKey: ['btob-pricing'], queryFn: getB2BPricing })

  const currentOverrides = useMemo<Record<string, number>>(() => {
    try {
      const parsed = JSON.parse(b2bQuery.data?.data.group_model_ratio || '{}')
      return parsed[B2B_GROUP] || {}
    } catch {
      return {}
    }
  }, [b2bQuery.data])

  const vendorGroups = useMemo<VendorGroup[]>(() => {
    const data = pricingQuery.data
    if (!data?.vendors || !data?.data) return []
    return data.vendors
      .map((vendor) => ({
        vendor,
        models: data.data.filter(
          (m) => m.vendor_id === vendor.id && getCEndDiscount(m) != null
        ),
      }))
      .filter((g) => g.models.length > 0)
  }, [pricingQuery.data])

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Build the full group_model_ratio blob, preserving other groups.
      let full: Record<string, Record<string, number>>
      try {
        full = JSON.parse(b2bQuery.data?.data.group_model_ratio || '{}')
      } catch {
        full = {}
      }
      const btob: Record<string, number> = { ...(full[B2B_GROUP] || {}) }

      for (const g of vendorGroups) {
        const raw = targets[g.vendor.id]
        if (raw === undefined || raw === '') continue
        const pct = Number(raw)
        if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) continue
        const target = pct / 100
        for (const m of g.models) {
          const cEnd = getCEndDiscount(m)
          const override = computeOverride(cEnd, target)
          btob[m.model_name] = override
        }
      }
      full[B2B_GROUP] = btob
      const res = await updateB2BPricing({
        group_model_ratio: JSON.stringify(full),
      })
      if (!res.success) throw new Error(res.message || 'Save failed')
    },
    onSuccess: () => {
      toast.success(t('B2B pricing saved'))
      queryClient.invalidateQueries({ queryKey: ['btob-pricing'] })
      queryClient.invalidateQueries({ queryKey: ['pricing'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const provisionMutation = useMutation({
    mutationFn: () => provisionB2BGroup(B2B_GROUP),
    onSuccess: (res) => {
      if (!res.success) {
        toast.error(res.message || 'Provision failed')
        return
      }
      toast.success(
        t('B2B group provisioned ({{count}} channels updated)', {
          count: res.data?.channels_updated ?? 0,
        })
      )
      queryClient.invalidateQueries({ queryKey: ['pricing'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (pricingQuery.isLoading || b2bQuery.isLoading) {
    return (
      <div className='flex justify-center py-12'>
        <Spinner />
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>{t('Enable B2B group')}</CardTitle>
          <CardDescription>
            {t(
              'Adds the B2B group to every channel so B2B customers can actually call models. Run once (safe to repeat).'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant='outline'
            onClick={() => provisionMutation.mutate()}
            disabled={provisionMutation.isPending}
          >
            {provisionMutation.isPending && <Spinner className='mr-2 size-4' />}
            {t('Enable / Repair B2B group')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('B2B discount by vendor')}</CardTitle>
          <CardDescription>
            {t(
              'Set the final discount off the official price for each vendor (e.g. 85 = 8.5折, 60 = 6折). Applied per model on top of the group.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          <p className='text-muted-foreground rounded-md bg-muted/40 px-3 py-2 text-xs'>
            {t(
              'One discount per vendor, applied to ALL its models — text, image and video alike. Models without a recorded official price are omitted (they simply carry no discount badge).'
            )}
          </p>
          {vendorGroups.map((g) => {
            // Current B2B discount for this vendor, derived from the first model
            // that has an override recorded (all models of a vendor share one
            // discount, so any is representative). Shown as the section summary.
            const vendorNow = (() => {
              for (const m of g.models) {
                const cEnd = getCEndDiscount(m)
                const existing = currentOverrides[m.model_name]
                if (existing != null && cEnd != null) return cEnd * existing
              }
              return null
            })()
            return (
              <div key={g.vendor.id} className='space-y-2'>
                <div className='flex flex-wrap items-center gap-3'>
                  <Label className='w-28 font-medium'>{g.vendor.name}</Label>
                  <div className='flex items-center gap-2'>
                    <Input
                      type='number'
                      min={1}
                      max={99}
                      className='w-24'
                      placeholder={t('e.g. 85')}
                      value={targets[g.vendor.id] ?? ''}
                      onChange={(e) =>
                        setTargets((p) => ({
                          ...p,
                          [g.vendor.id]: e.target.value,
                        }))
                      }
                    />
                    <span className='text-muted-foreground text-sm'>
                      {zh ? '% (85=8.5折)' : '% off official'}
                    </span>
                  </div>
                  <span className='text-muted-foreground text-sm'>
                    {t('now')}:{' '}
                    <span className='text-foreground font-medium'>
                      {vendorNow != null ? formatDiscount(vendorNow, zh) : '—'}
                    </span>
                    <span className='ml-1'>
                      ({g.models.length} {t('models')})
                    </span>
                  </span>
                </div>
                {/* Full model list for this vendor — text, image and video. */}
                <div className='text-muted-foreground grid grid-cols-1 gap-x-6 gap-y-1 pl-28 text-xs sm:grid-cols-2 lg:grid-cols-3'>
                  {g.models.map((m) => (
                    <span key={m.model_name} className='truncate font-mono'>
                      {m.model_name}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending && <Spinner className='mr-2 size-4' />}
            {t('Save B2B pricing')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
