import { describe, expect, test } from 'bun:test'
import {
  getUsageCreditAmountRange,
  getUsageCreditEstimates,
} from '../src/features/wallet/lib/usage-credit'
import type { PricingModel } from '../src/features/pricing/types'

function tokenModel(name: string, discount: number): PricingModel {
  return {
    model_name: name,
    quota_type: 0,
    model_ratio: 0.5,
    model_price: 0,
    official_input_price: 1,
    enable_groups: ['b2b_16'],
    group_ratio: { b2b_16: discount },
  } as PricingModel
}

describe('wallet usage credit estimates', () => {
  test('shows a range when models from one vendor have different discounts', () => {
    const estimates = getUsageCreditEstimates([
      tokenModel('gemini-standard', 0.65),
      tokenModel('gemini-special', 0.6),
    ])
    const gemini = estimates.find((row) => row.key === 'Gemini usage credit')

    expect(gemini).toBeDefined()
    expect(getUsageCreditAmountRange(20, gemini!)).toEqual({
      min: 31,
      max: 33,
    })
  })

  test('keeps a single value when every model has the same discount', () => {
    const estimates = getUsageCreditEstimates([
      tokenModel('gpt-standard', 0.65),
      tokenModel('gpt-special', 0.65),
    ])
    const gpt = estimates.find((row) => row.key === 'ChatGPT usage credit')

    expect(gpt).toBeDefined()
    expect(getUsageCreditAmountRange(20, gpt!)).toEqual({
      min: 31,
      max: 31,
    })
  })
})
