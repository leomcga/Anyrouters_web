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
import { getModelDiscount } from '@/features/pricing/lib/discount'
import type { PricingModel } from '@/features/pricing/types'

const USAGE_CREDIT_VENDORS: Array<{ key: string; match: RegExp }> = [
  { key: 'Claude usage credit', match: /claude/i },
  { key: 'ChatGPT usage credit', match: /gpt|chatgpt|codex/i },
  { key: 'Gemini usage credit', match: /gemini/i },
]

export interface UsageCreditEstimate {
  key: string
  minMultiplier: number
  maxMultiplier: number
}

export function getUsageCreditEstimates(
  models: PricingModel[]
): UsageCreditEstimate[] {
  return USAGE_CREDIT_VENDORS.map(({ key, match }) => {
    const rates: number[] = []
    for (const model of models) {
      if (!match.test(model.model_name || '')) continue
      const discount = getModelDiscount(model)
      if (discount.hasDiscount && discount.rate > 0 && discount.rate < 1) {
        rates.push(discount.rate)
      }
    }

    if (rates.length === 0) {
      return { key, minMultiplier: 1, maxMultiplier: 1 }
    }

    const lowestRate = Math.min(...rates)
    const highestRate = Math.max(...rates)

    return {
      key,
      minMultiplier: 1 / highestRate,
      maxMultiplier: 1 / lowestRate,
    }
  })
}

export function getUsageCreditAmountRange(
  amount: number,
  estimate: UsageCreditEstimate
): { min: number; max: number } {
  return {
    min: Math.round(amount * estimate.minMultiplier),
    max: Math.round(amount * estimate.maxMultiplier),
  }
}
