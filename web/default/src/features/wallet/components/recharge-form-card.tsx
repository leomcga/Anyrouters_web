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
import { useState, useEffect } from 'react'
import { Loader2, Receipt, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  getDiscountLabel,
  getPaymentIcon,
  getMinTopupAmount,
  calculatePresetPricing,
} from '../lib'
import type {
  PaymentMethod,
  PresetAmount,
  TopupInfo,
  CreemProduct,
  WaffoPayMethod,
} from '../types'

// Decorative tier names for the preset tiles (kept in English like the design).
const PRESET_TIER_NAMES = ['Starter', 'Basic', 'Standard', 'Plus', 'Pro', 'Max']

// "Approximately" breakdown — how much usage the credit is worth per vendor,
// relative to official list price. Multipliers mirror the headline discount
// (OpenAI ~1/10 of list, Claude & Gemini ~1/5). Adjust if pricing changes.
const USAGE_CREDIT: Array<{ key: string; multiplier: number }> = [
  { key: 'Claude usage credit', multiplier: 5 },
  { key: 'OpenAI usage credit', multiplier: 10 },
  { key: 'Gemini usage credit', multiplier: 5 },
]

interface RechargeFormCardProps {
  topupInfo: TopupInfo | null
  presetAmounts: PresetAmount[]
  selectedPreset: number | null
  onSelectPreset: (preset: PresetAmount) => void
  topupAmount: number
  onTopupAmountChange: (amount: number) => void
  paymentAmount: number
  calculating: boolean
  onPaymentMethodSelect: (method: PaymentMethod) => void
  paymentLoading: string | null
  redemptionCode: string
  onRedemptionCodeChange: (code: string) => void
  onRedeem: () => void
  redeeming: boolean
  topupLink?: string
  loading?: boolean
  priceRatio?: number
  usdExchangeRate?: number
  onOpenBilling?: () => void
  creemProducts?: CreemProduct[]
  enableCreemTopup?: boolean
  onCreemProductSelect?: (product: CreemProduct) => void
  enableWaffoTopup?: boolean
  waffoPayMethods?: WaffoPayMethod[]
  waffoMinTopup?: number
  onWaffoMethodSelect?: (method: WaffoPayMethod, index: number) => void
  enableWaffoPancakeTopup?: boolean
}

export function RechargeFormCard({
  topupInfo,
  presetAmounts,
  selectedPreset,
  onSelectPreset,
  topupAmount,
  onTopupAmountChange,
  onPaymentMethodSelect,
  paymentLoading,
  loading,
  priceRatio = 1,
  usdExchangeRate = 1,
  onOpenBilling,
}: RechargeFormCardProps) {
  const { t } = useTranslation()
  const [localAmount, setLocalAmount] = useState(topupAmount.toString())

  useEffect(() => {
    setLocalAmount(topupAmount.toString())
  }, [topupAmount])

  const handleAmountChange = (value: string) => {
    setLocalAmount(value)
    const numValue = parseInt(value) || 0
    if (numValue >= 0) {
      onTopupAmountChange(numValue)
    }
  }

  const hasStandardPaymentMethods =
    Array.isArray(topupInfo?.pay_methods) && topupInfo.pay_methods.length > 0
  const minTopup = getMinTopupAmount(topupInfo)
  // A single gateway (Stripe bundles Alipay / cards / Apple Pay) is shown as one
  // prominent pay button instead of a lone method chip.
  const singlePayMethod =
    hasStandardPaymentMethods && topupInfo?.pay_methods?.length === 1
      ? topupInfo.pay_methods[0]
      : null

  if (loading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <CardHeader className='border-b p-3 !pb-3 sm:p-5 sm:!pb-5'>
          <Skeleton className='h-6 w-32' />
          <Skeleton className='mt-2 h-4 w-64' />
        </CardHeader>
        <CardContent className='space-y-4 p-3 sm:space-y-6 sm:p-5'>
          <div className='grid grid-cols-2 gap-2 sm:gap-3'>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className='h-[76px] rounded-xl' />
            ))}
          </div>
          <Skeleton className='h-11 w-full' />
          <Skeleton className='h-24 w-full rounded-xl' />
          <Skeleton className='h-12 w-full rounded-xl' />
        </CardContent>
      </Card>
    )
  }

  return (
    <TitledCard
      title={t('Add Funds')}
      description={t(
        'OpenAI models from ~10% of list price, Claude & Gemini from ~20%; discounts may shift with upstream costs.'
      )}
      icon={<WalletCards className='h-4 w-4' />}
      disableHoverEffect
      action={
        onOpenBilling ? (
          <Button
            variant='outline'
            size='sm'
            onClick={onOpenBilling}
            className='w-full gap-2 sm:w-auto'
          >
            <Receipt className='h-4 w-4' />
            {t('Order History')}
          </Button>
        ) : null
      }
      contentClassName='space-y-4 sm:space-y-5'
    >
      {hasStandardPaymentMethods ? (
        <>
          {/* Preset amounts */}
          {presetAmounts.length > 0 && (
            <div className='grid grid-cols-2 gap-2 sm:gap-3'>
              {presetAmounts.map((preset, index) => {
                const discount =
                  preset.discount ||
                  topupInfo?.discount?.[preset.value] ||
                  1.0
                const { displayValue, hasDiscount } = calculatePresetPricing(
                  preset.value,
                  priceRatio,
                  discount,
                  usdExchangeRate
                )
                const isSelected = selectedPreset === preset.value
                return (
                  <button
                    key={index}
                    type='button'
                    onClick={() => onSelectPreset(preset)}
                    className={cn(
                      'relative flex flex-col items-start rounded-xl border p-3.5 text-left transition-all sm:p-4',
                      isSelected
                        ? 'border-foreground ring-foreground bg-foreground/[0.03] ring-1 dark:bg-foreground/[0.07]'
                        : 'border-border hover:border-foreground/30 hover:bg-muted/30'
                    )}
                  >
                    {PRESET_TIER_NAMES[index] && (
                      <span className='text-sm font-semibold'>
                        {PRESET_TIER_NAMES[index]}
                      </span>
                    )}
                    <span className='text-muted-foreground mt-0.5 text-base font-medium tabular-nums sm:text-lg'>
                      ${formatNumber(displayValue)}
                    </span>
                    {hasDiscount && (
                      <span className='absolute top-2.5 right-2.5 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400'>
                        {getDiscountLabel(discount)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* Custom amount */}
          <div className='space-y-2'>
            <Label
              htmlFor='topup-amount'
              className='text-muted-foreground text-xs font-medium tracking-wider uppercase'
            >
              {t('Custom Amount')}
              <span className='text-muted-foreground/60 ml-1.5 normal-case'>
                {t('min {{amount}}', { amount: `$${minTopup}` })}
              </span>
            </Label>
            <div className='relative'>
              <span className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base font-medium sm:text-lg'>
                $
              </span>
              <Input
                id='topup-amount'
                type='number'
                value={localAmount}
                onChange={(e) => handleAmountChange(e.target.value)}
                min={minTopup}
                placeholder={t('Enter USD amount')}
                className='h-10 pl-7 text-base sm:h-11 sm:text-lg'
              />
            </div>
          </div>

          {/* Approximate usage credit */}
          {topupAmount > 0 && (
            <div className='bg-muted/50 space-y-1.5 rounded-xl p-3.5'>
              <div className='text-muted-foreground text-xs'>
                {t('Approximately')}
              </div>
              {USAGE_CREDIT.map((row) => (
                <div
                  key={row.key}
                  className='flex items-center justify-between text-sm'
                >
                  <span className='text-muted-foreground'>{t(row.key)}</span>
                  <span className='font-semibold tabular-nums'>
                    ${formatNumber(topupAmount * row.multiplier)}
                  </span>
                </div>
              ))}
              <p className='text-muted-foreground/70 pt-1 text-[11px]'>
                {t('Actual usage depends on live pricing.')}
              </p>
            </div>
          )}

          {/* Pay button */}
          {singlePayMethod ? (
            <div className='space-y-2'>
              <Button
                onClick={() => onPaymentMethodSelect(singlePayMethod)}
                disabled={
                  (singlePayMethod.min_topup || 0) > topupAmount ||
                  topupAmount < minTopup ||
                  !!paymentLoading
                }
                className='h-12 w-full gap-2 rounded-xl text-base font-semibold'
              >
                {paymentLoading === singlePayMethod.type && (
                  <Loader2 className='h-5 w-5 animate-spin' />
                )}
                {t('Pay {{amount}}', {
                  amount: `$${formatNumber(topupAmount)}`,
                })}
              </Button>
              <p className='text-muted-foreground text-center text-xs'>
                {t('Supports Alipay, cards, Apple Pay and more')}
              </p>
            </div>
          ) : (
            <div className='grid grid-cols-2 gap-1.5 sm:gap-3 lg:grid-cols-3'>
              {topupInfo?.pay_methods?.map((method) => {
                const methodMin = method.min_topup || 0
                const disabled = methodMin > topupAmount

                const button = (
                  <Button
                    key={method.type}
                    variant='outline'
                    onClick={() => onPaymentMethodSelect(method)}
                    disabled={disabled || !!paymentLoading}
                    className='h-10 min-w-0 justify-start gap-2 rounded-lg px-3'
                  >
                    {paymentLoading === method.type ? (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    ) : (
                      getPaymentIcon(
                        method.type,
                        'h-4 w-4',
                        method.icon,
                        method.name
                      )
                    )}
                    <span className='truncate'>{method.name}</span>
                  </Button>
                )

                return disabled ? (
                  <TooltipProvider key={method.type}>
                    <Tooltip>
                      <TooltipTrigger render={button}></TooltipTrigger>
                      <TooltipContent>
                        {t('Minimum topup amount: {{amount}}', {
                          amount: methodMin,
                        })}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  button
                )
              })}
            </div>
          )}

          <p className='text-muted-foreground text-xs leading-relaxed'>
            {t(
              'Your USD balance never expires and is deducted automatically as you use the API.'
            )}
          </p>
        </>
      ) : (
        <Alert>
          <AlertDescription>
            {t(
              'Online topup is not enabled. Please use redemption code or contact administrator.'
            )}
          </AlertDescription>
        </Alert>
      )}
    </TitledCard>
  )
}
