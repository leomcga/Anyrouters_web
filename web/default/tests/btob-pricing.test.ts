import { describe, expect, test } from 'bun:test'
import type { PricingModel, PricingVendor } from '../src/features/pricing/types'
import {
  applyVendorTargetDiscount,
  getCEndDiscount,
  groupVendorDiscounts,
  isDedicatedB2BGroup,
} from '../src/features/btob/lib'

const gpt56Models = [
  {
    model_name: 'gpt-5.6-sol',
    quota_type: 0,
    model_ratio: 2.5,
    model_price: 0,
    official_input_price: 5,
    vendor_id: 3,
  },
  {
    model_name: 'gpt-5.6-terra',
    quota_type: 0,
    model_ratio: 1.25,
    model_price: 0,
    official_input_price: 2.5,
    vendor_id: 3,
  },
  {
    model_name: 'gpt-5.6-luna',
    quota_type: 0,
    model_ratio: 0.5,
    model_price: 0,
    official_input_price: 1,
    vendor_id: 3,
  },
] as PricingModel[]

describe('B2B GPT-5.6 pricing', () => {
  test('all three models are eligible for percentage editing', () => {
    for (const model of gpt56Models) {
      expect(getCEndDiscount(model)).toBe(1)
    }
  })

  test('one OpenAI vendor target updates every GPT-5.6 model', () => {
    const result = applyVendorTargetDiscount(
      { 'gpt-5.5': 0.65 },
      gpt56Models,
      0.6
    )

    expect(result).toEqual({
      'gpt-5.5': 0.65,
      'gpt-5.6-sol': 0.6,
      'gpt-5.6-terra': 0.6,
      'gpt-5.6-luna': 0.6,
    })
  })

  test('group summary reports the stored final discount', () => {
    const vendors = [{ id: 3, name: 'OpenAI' }] as PricingVendor[]
    const summary = groupVendorDiscounts(gpt56Models, vendors, {
      'gpt-5.6-sol': 0.65,
      'gpt-5.6-terra': 0.65,
      'gpt-5.6-luna': 0.65,
    })

    expect(summary).toEqual([{ vendorName: 'OpenAI', discount: 0.65 }])
  })

  test('only canonical numeric customer groups are dedicated', () => {
    expect(isDedicatedB2BGroup('b2b_16')).toBe(true)
    expect(isDedicatedB2BGroup('b2b_enterprise')).toBe(false)
    expect(isDedicatedB2BGroup('b2b_001')).toBe(false)
    expect(isDedicatedB2BGroup('btob')).toBe(false)
    expect(isDedicatedB2BGroup('b2b_9223372036854775807')).toBe(true)
    expect(isDedicatedB2BGroup('b2b_9223372036854775808')).toBe(false)
  })
})
