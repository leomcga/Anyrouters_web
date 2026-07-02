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
import type { PricingModel, PricingVendor } from '@/features/pricing/types'

// Input-token "ratio -> USD per 1M" factor: model_ratio * this = USD/1M.
// Mirrors pricing/lib/discount.ts so the B2B page reasons about the same price.
const RATIO_TO_USD_PER_M = 2

/**
 * C-end (default group) effective discount for a model, derived the same way
 * the marketplace does: shown price / official list price. Returns null when we
 * can't derive it (no official price, or a per-request model whose official
 * per-call price isn't recorded) — those models can't get an auto override.
 */
export function getCEndDiscount(model: PricingModel): number | null {
  const official = model.official_input_price
  if (!official || official <= 0) return null

  // Token-based: shown = model_ratio * 2 (default group ratio = 1).
  // Per-request: shown = model_price (default group ratio = 1).
  const shown =
    model.quota_type === 0
      ? model.model_ratio * RATIO_TO_USD_PER_M
      : (model.model_price ?? 0)
  if (shown <= 0) return null

  const rate = shown / official
  return Math.round(rate * 1000) / 1000
}

/**
 * Given a model's C-end discount and a desired B2B target discount (relative to
 * the vendor's OFFICIAL price, e.g. 0.85 for 8.5折), compute the per-model
 * override multiplier applied on top of the group ratio:
 *
 *     override = targetDiscount / cEndDiscount
 *
 * Because billing charges model_ratio * groupRatio * override, and the C-end
 * price already bakes cEndDiscount into model_ratio, this lands the effective
 * price at exactly targetDiscount * official. Returns 1 (no-op) if inputs are
 * invalid.
 */
export function computeOverride(
  cEndDiscount: number | null,
  targetDiscount: number
): number {
  if (!cEndDiscount || cEndDiscount <= 0 || targetDiscount <= 0) return 1
  return Math.round((targetDiscount / cEndDiscount) * 100000) / 100000
}

/** Format a discount rate (0.85) as a zh 折 label ("8.5折") or "% OFF". */
export function formatDiscount(rate: number, zh: boolean): string {
  if (rate <= 0 || rate >= 1) return zh ? '无折扣' : 'No discount'
  if (zh) {
    const zhe = Math.round(rate * 100) / 10
    const s = Number.isInteger(zhe) ? String(zhe) : zhe.toFixed(1)
    return `${s}折`
  }
  return `${Math.round((1 - rate) * 100)}% OFF`
}

export const B2B_GROUP = 'btob'

/**
 * A group's effective per-vendor discount summary, derived from its
 * group_model_ratio overrides. Vendor names come from the vendors list keyed by
 * vendor_id (pricing models carry vendor_id, not vendor_name). For each vendor
 * we take a representative model (all of a vendor's models share one target
 * discount in this system) and compute effectiveDiscount = cEndDiscount *
 * override — the real discount off the official price this group pays. Vendors
 * with no override for the group fall back to the C-end discount. Returns
 * [{ vendorName, discount }] sorted by vendor name.
 */
export function groupVendorDiscounts(
  models: PricingModel[],
  vendors: PricingVendor[],
  overrides: Record<string, number>
): { vendorName: string; discount: number }[] {
  const vendorName = new Map<number, string>()
  for (const v of vendors) vendorName.set(v.id, v.name)
  const byVendor = new Map<number, number>()
  for (const m of models) {
    if (m.vendor_id == null) continue
    if (byVendor.has(m.vendor_id)) continue // one representative per vendor
    const cEnd = getCEndDiscount(m)
    if (cEnd == null) continue
    const override = overrides[m.model_name]
    const effective = override != null ? cEnd * override : cEnd
    byVendor.set(m.vendor_id, Math.round(effective * 1000) / 1000)
  }
  return Array.from(byVendor.entries())
    .map(([id, discount]) => ({ vendorName: vendorName.get(id) || '—', discount }))
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName))
}
