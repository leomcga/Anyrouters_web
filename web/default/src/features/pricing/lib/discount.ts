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
import { QUOTA_TYPE_VALUES } from '../constants'
import { getMinGroupRatio } from './price'
import type { PricingModel } from '../types'

// ---------------------------------------------------------------------------
// Discount model — NOTHING is hardcoded.
// ---------------------------------------------------------------------------
//
// The discount rate is DERIVED from real data, never a hardcoded per-vendor
// constant:
//
//     discount = shown price / official list price
//
// where:
//   - official list price = the vendor's public price, stored per-model on the
//     backend (Model.OfficialInputPrice / OfficialOutputPrice, USD per 1M).
//   - shown price = the customer-facing price computed from model_ratio and the
//     CURRENT ACCOUNT's group ratio. Because the shown price already reflects
//     the logged-in account's group, the derived discount is automatically
//     per-account: a normal user sees 7折 on GPT, a B2B account sees 6折 — with
//     zero rate hardcoded and no extra frontend logic.
//
// If a model has no official price recorded, we show NO discount (never guess).

/** Input-token "ratio -> USD per 1M" factor: model_ratio * this = USD/1M. */
const RATIO_TO_USD_PER_M = 2

export type ModelDiscount = {
  /** Discount multiplier (shown / official), e.g. 0.7. 1 = no discount. */
  rate: number
  /** Whether a real discount exists and is worth displaying. */
  hasDiscount: boolean
}

/**
 * Derive the discount applied to a model's displayed price from real data.
 * Uses the input price (model_ratio) against the recorded official input price.
 * Returns no discount when official price is missing or numbers are invalid.
 */
export function getModelDiscount(model: PricingModel): ModelDiscount {
  const official = model.official_input_price
  // Only token-based models carry an input list price we can compare against.
  if (
    model.quota_type === QUOTA_TYPE_VALUES.REQUEST ||
    !official ||
    official <= 0
  ) {
    return { rate: 1, hasDiscount: false }
  }

  // Shown input price (USD per 1M), reflecting the current account's group.
  const enableGroups = Array.isArray(model.enable_groups)
    ? model.enable_groups
    : []
  const minRatio = getMinGroupRatio(enableGroups, model.group_ratio || {})
  const shownUsdPerM = model.model_ratio * RATIO_TO_USD_PER_M * minRatio

  if (shownUsdPerM <= 0) {
    return { rate: 1, hasDiscount: false }
  }

  const rate = shownUsdPerM / official
  // Guard against bad data (e.g. official price lower than shown => rate >= 1).
  // Round to 3 decimals so 0.7000001 reads as 0.7.
  const rounded = Math.round(rate * 1000) / 1000
  return { rate: rounded, hasDiscount: rounded > 0 && rounded < 1 }
}

/**
 * Format a discount rate for display.
 * zh convention uses 折 (fraction of price still paid): 0.7 -> "7折", 0.85 -> "8.5折".
 * Other locales use "% OFF": 0.7 -> "30% OFF".
 */
export function formatDiscountLabel(
  rate: number,
  locale: 'zh' | 'other'
): string {
  if (rate <= 0 || rate >= 1) return ''
  if (locale === 'zh') {
    const zhe = Math.round(rate * 100) / 10 // 0.7 -> 7；0.85 -> 8.5
    const zheStr = Number.isInteger(zhe) ? String(zhe) : zhe.toFixed(1)
    return `${zheStr}折`
  }
  const off = Math.round((1 - rate) * 100)
  return `${off}% OFF`
}
