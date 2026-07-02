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
import { memo } from 'react'
import { ChevronRight, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { StatusBadge } from '@/components/status-badge'
import { DEFAULT_TOKEN_UNIT } from '../constants'
import { formatDiscountLabel, getModelDiscount } from '../lib/discount'
import {
  getDynamicDisplayGroupRatio,
  getDynamicPricingSummary,
} from '../lib/dynamic-price'
import { parseTags } from '../lib/filters'
import { isTokenBasedModel } from '../lib/model-helpers'
import { formatPrice, formatRequestPrice } from '../lib/price'
import type { PricingModel, TokenUnit } from '../types'
import { ModelPerfBadge, type ModelPerfBadgeData } from './model-perf-badge'

export interface ModelCardProps {
  model: PricingModel
  onClick: () => void
  priceRate?: number
  usdExchangeRate?: number
  tokenUnit?: TokenUnit
  showRechargePrice?: boolean
  perf?: ModelPerfBadgeData
}

export const ModelCard = memo(function ModelCard(props: ModelCardProps) {
  const { t, i18n } = useTranslation()
  const { copyToClipboard } = useCopyToClipboard()
  const tokenUnit = props.tokenUnit ?? DEFAULT_TOKEN_UNIT
  const priceRate = props.priceRate ?? 1
  const usdExchangeRate = props.usdExchangeRate ?? 1
  const showRechargePrice = props.showRechargePrice ?? false
  const isTokenBased = isTokenBasedModel(props.model)
  const tokenUnitLabel = tokenUnit === 'K' ? '1K' : '1M'
  const tags = parseTags(props.model.tags)
  const groups = props.model.enable_groups || []
  const endpoints = props.model.supported_endpoint_types || []
  const modelIconKey = props.model.icon || props.model.vendor_icon
  const modelIcon = modelIconKey ? getLobeIcon(modelIconKey, 28) : null
  const initial = props.model.model_name?.charAt(0).toUpperCase() || '?'
  const isDynamicPricing =
    props.model.billing_mode === 'tiered_expr' &&
    Boolean(props.model.billing_expr)
  const hasCachedPrice = isTokenBased && props.model.cache_ratio != null
  const dynamicSummary = isDynamicPricing
    ? getDynamicPricingSummary(props.model, {
        tokenUnit,
        showRechargePrice,
        priceRate,
        usdExchangeRate,
        groupRatioMultiplier: getDynamicDisplayGroupRatio(props.model),
      })
    : null

  const primaryGroup = groups[0]
  const bottomTags = [...endpoints.slice(0, 2), ...tags.slice(0, 2)]
  const hiddenCount =
    Math.max(groups.length - 1, 0) +
    Math.max(endpoints.length - 2, 0) +
    Math.max(tags.length - 2, 0)

  // Discount: shown prices are already discounted; reconstruct the vendor's
  // official price (÷ discount rate) to render a struck-through original and a
  // discount badge. Dynamic-pricing models are skipped (their price isn't a
  // simple vendor list price). See lib/discount.ts for the per-vendor rates and
  // the phase-2 per-account plan.
  const discount = getModelDiscount(props.model)
  const showDiscount = discount.hasDiscount && !isDynamicPricing
  const discountLabel = showDiscount
    ? formatDiscountLabel(
        discount.rate,
        i18n.language?.startsWith('zh') ? 'zh' : 'other'
      )
    : ''

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    copyToClipboard(props.model.model_name || '')
  }

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl border p-3 transition-colors sm:p-5',
        'hover:bg-muted/20'
      )}
    >
      {/* Header: icon + name + price + actions */}
      <div className='flex items-start justify-between gap-2.5 sm:gap-3'>
        <div className='flex min-w-0 items-start gap-2.5 sm:gap-3'>
          <div className='bg-muted/40 flex size-9 shrink-0 items-center justify-center rounded-lg sm:size-10 sm:rounded-xl'>
            {modelIcon || (
              <span className='text-muted-foreground text-sm font-bold'>
                {initial}
              </span>
            )}
          </div>
          <div className='min-w-0'>
            <h3 className='text-foreground truncate font-mono text-[15px] leading-tight font-bold'>
              {props.model.model_name}
            </h3>
            <div className='mt-0.5 flex min-h-[3.25rem] flex-wrap content-start items-baseline gap-x-2 gap-y-0.5 text-xs sm:mt-1 sm:gap-x-3'>
              {props.model.comingSoon ? (
                <span className='inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400'>
                  {t('Coming soon')}
                </span>
              ) : dynamicSummary ? (
                dynamicSummary.isSpecialExpression ? (
                  <span className='min-w-0'>
                    <span className='text-amber-700 dark:text-amber-300'>
                      {t('Special billing expression')}
                    </span>
                    <code className='text-muted-foreground/70 mt-0.5 line-clamp-1 block font-mono text-[11px] break-all'>
                      {dynamicSummary.rawExpression}
                    </code>
                  </span>
                ) : dynamicSummary.primaryEntries.length > 0 ? (
                  <>
                    {dynamicSummary.primaryEntries.map((entry) => (
                      <span
                        key={entry.key}
                        className='text-muted-foreground whitespace-nowrap'
                      >
                        {t(entry.shortLabel)}{' '}
                        <span className='text-foreground font-mono font-semibold'>
                          {entry.formatted}
                        </span>
                        /{tokenUnitLabel}
                      </span>
                    ))}
                  </>
                ) : (
                  <span className='text-muted-foreground text-xs'>
                    {t('Dynamic Pricing')}
                  </span>
                )
              ) : isTokenBased ? (
                <>
                  <span className='text-muted-foreground whitespace-nowrap'>
                    {t('Input')}{' '}
                    <span
                      className={cn(
                        'font-mono font-semibold',
                        showDiscount
                          ? 'text-[var(--primary)]'
                          : 'text-foreground'
                      )}
                    >
                      {formatPrice(
                        props.model,
                        'input',
                        tokenUnit,
                        showRechargePrice,
                        priceRate,
                        usdExchangeRate
                      )}
                    </span>
                    /{tokenUnitLabel}
                    {showDiscount && (
                      <span className='text-muted-foreground/40 ml-1 font-mono line-through'>
                        {formatPrice(
                          props.model,
                          'input',
                          tokenUnit,
                          showRechargePrice,
                          priceRate,
                          usdExchangeRate,
                          discount.rate
                        )}
                      </span>
                    )}
                  </span>
                  <span className='text-muted-foreground whitespace-nowrap'>
                    {t('Output')}{' '}
                    <span
                      className={cn(
                        'font-mono font-semibold',
                        showDiscount
                          ? 'text-[var(--primary)]'
                          : 'text-foreground'
                      )}
                    >
                      {formatPrice(
                        props.model,
                        'output',
                        tokenUnit,
                        showRechargePrice,
                        priceRate,
                        usdExchangeRate
                      )}
                    </span>
                    /{tokenUnitLabel}
                    {showDiscount && (
                      <span className='text-muted-foreground/40 ml-1 font-mono line-through'>
                        {formatPrice(
                          props.model,
                          'output',
                          tokenUnit,
                          showRechargePrice,
                          priceRate,
                          usdExchangeRate,
                          discount.rate
                        )}
                      </span>
                    )}
                  </span>
                  {hasCachedPrice && (
                    <span className='text-muted-foreground/60 whitespace-nowrap'>
                      {t('Cached')}{' '}
                      <span className='font-mono'>
                        {formatPrice(
                          props.model,
                          'cache',
                          tokenUnit,
                          showRechargePrice,
                          priceRate,
                          usdExchangeRate
                        )}
                      </span>
                    </span>
                  )}
                </>
              ) : (
                <span className='text-muted-foreground whitespace-nowrap'>
                  <span
                    className={cn(
                      'font-mono font-semibold',
                      showDiscount ? 'text-[var(--primary)]' : 'text-foreground'
                    )}
                  >
                    {formatRequestPrice(
                      props.model,
                      showRechargePrice,
                      priceRate,
                      usdExchangeRate
                    )}
                  </span>{' '}
                  / {t('request')}
                  {showDiscount && (
                    <span className='text-muted-foreground/40 ml-1 font-mono line-through'>
                      {formatRequestPrice(
                        props.model,
                        showRechargePrice,
                        priceRate,
                        usdExchangeRate,
                        discount.rate
                      )}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className='flex shrink-0 items-center gap-1.5'>
          <button
            type='button'
            onClick={props.onClick}
            className='text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors sm:px-2.5 sm:py-1.5'
          >
            {t('Details')}
            <ChevronRight className='size-3.5' />
          </button>
          <button
            type='button'
            onClick={handleCopy}
            className='text-muted-foreground hover:text-foreground hover:bg-muted rounded-md border p-1.5 transition-colors'
            title={t('Copy')}
          >
            <Copy className='size-3.5' />
          </button>
        </div>
      </div>

      {/* Description — locked to a fixed height (1 line on mobile, 2 on sm+) so
          every card's footer starts at the same Y regardless of description
          length. A trailing spacer (below) absorbs any leftover space instead
          of stretching this block. */}
      <p className='text-muted-foreground mt-2 line-clamp-1 h-[1.25rem] text-[13px] leading-relaxed sm:mt-4 sm:line-clamp-2 sm:h-[2.5rem]'>
        {props.model.description || t('No description available.')}
      </p>

      {/* Footer — top-anchored right after the fixed-height description so the
          billing-type row lands at the same Y across a row of cards; extra height
          (perf badge, wrapped tags) overflows downward into the equal-height grid
          row as bottom padding. Both left-column rows are pinned to col 1 / explicit
          grid rows so the layout is identical whether or not the perf badge renders
          — otherwise a model with no perf data (image/video) would leave the grid
          with two children and auto-placement would drop the tags into col 2,
          overlapping the billing-type label. */}
      <div className='mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 sm:mt-4'>
        <div className='col-start-1 row-start-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
          {/* Only worth showing when a model spans more than one group. */}
          {groups.length > 1 && primaryGroup && (
            <span className='text-muted-foreground shrink-0 text-xs font-medium whitespace-nowrap'>
              {primaryGroup} {t('Groups')}
            </span>
          )}
          <span className='text-muted-foreground shrink-0 text-xs font-medium whitespace-nowrap'>
            {isTokenBased ? t('Token-based') : t('Per Request')}
          </span>
          {isDynamicPricing && (
            <StatusBadge
              label={t('Dynamic Pricing')}
              variant='warning'
              copyable={false}
              size='sm'
            />
          )}
        </div>
        <ModelPerfBadge
          perf={props.perf}
          className='col-start-2 row-start-1 self-start'
        />

        <div
          className={cn(
            'col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 sm:gap-x-3 sm:gap-y-1',
            // Leave room on the right for the absolutely-positioned discount
            // badge (bottom-right corner) so tags never run under it.
            showDiscount && 'pr-14 sm:pr-16'
          )}
        >
          {bottomTags.map((item) => (
            <span
              key={item}
              className='text-muted-foreground/70 text-xs whitespace-nowrap'
            >
              {item}
            </span>
          ))}
          <span className='text-muted-foreground/50 text-xs'>
            {tokenUnitLabel}
          </span>
          {hiddenCount > 0 && (
            <span className='text-muted-foreground/40 text-xs'>
              +{hiddenCount}
            </span>
          )}
        </div>
      </div>

      {/* Discount badge — bottom-right corner (absolute, out of flow). The perf
          badge sits at row-start-1 (upper right) and the tag row reserves right
          padding above, so the two right-side elements never collide. */}
      {showDiscount && (
        <span className='absolute right-3 bottom-3 rounded-md bg-[var(--primary)]/10 px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap text-[var(--primary)] sm:right-5 sm:bottom-5'>
          {discountLabel}
        </span>
      )}
    </div>
  )
})
